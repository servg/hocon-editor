# hocon-editor

Визуальный редактор SpringFlow-процессов в формате HOCON. Позволяет загружать, редактировать через UI и экспортировать обратно HOCON-файлы, описывающие многошаговые бизнес-процессы.

**Живой адрес:** http://95.81.100.67:8090/

---

## Стек технологий

| Слой | Технология |
|---|---|
| Backend | Spring Boot 4.0.3, Java 21 |
| Шаблонизатор | Thymeleaf |
| Frontend | Vanilla JS (ES5+), jQuery 3.7, Bootstrap 5.3 |
| SQL-редактор | CodeMirror 5 (SQL mode) |
| Сборка | Maven (`pom.xml`) |
| Порт | 8090 |

---

## Быстрый старт

```bash
mvn spring-boot:run
# открыть http://localhost:8090/
```

Статические файлы отдаются без кэша (`spring.web.resources.cache.period: 0`) — изменения в JS/CSS видны сразу без перезапуска сервера.

---

## Структура проекта

```
hocon-editor/
├── pom.xml
└── src/
    ├── main/
    │   ├── java/com/example/hoconeditor/
    │   │   ├── HoconEditorApplication.java       # точка входа Spring Boot
    │   │   ├── controller/
    │   │   │   ├── EditorController.java          # GET / → editor.html
    │   │   │   └── ApiController.java             # REST API
    │   │   ├── model/
    │   │   │   ├── FlowProcess.java               # DTO: variables + steps + outputs
    │   │   │   ├── StepTypeDescriptor.java        # описание типа шага
    │   │   │   └── FieldDescriptor.java           # описание поля формы типа шага
    │   │   └── service/
    │   │       ├── StepTypeRegistry.java          # реестр типов шагов (in-memory)
    │   │       └── HoconFileService.java          # загрузка sample-файлов с classpath
    │   └── resources/
    │       ├── application.yml                    # порт, кэш
    │       ├── hocon-samples/
    │       │   └── sample-flow.conf               # пример процесса для кнопки "Загрузить пример"
    │       ├── templates/
    │       │   └── editor.html                    # единственная Thymeleaf-страница
    │       └── static/
    │           ├── css/
    │           │   └── editor.css                 # все стили приложения
    │           └── js/
    │               ├── hocon-parser.js            # парсер HOCON → объекты
    │               ├── hocon-serializer.js        # объекты → HOCON-текст
    │               ├── flow-renderer.js           # граф: топология, SVG-линии, рендер нод
    │               ├── variables-editor.js        # таблица переменных процесса
    │               ├── step-editor.js             # модальное окно редактирования шага
    │               └── app.js                     # главный модуль: state, события, оркестрация
    └── test/
        └── java/com/example/hoconeditor/
            ├── ApiControllerTest.java
            └── HoconFileServiceTest.java
```

---

## REST API

Все эндпоинты — `/api/*`.

### `GET /api/step-types`
Возвращает список всех зарегистрированных типов шагов **без полей форм** (только `type`, `label`, `description`, флаги).

### `GET /api/step-types/{type}`
Возвращает полный `StepTypeDescriptor` для типа — включая `fields[]` и `hints[]`. Используется при открытии модального окна редактирования.

### `GET /api/connections`
Возвращает список строк — доступных JDBC-подключений. Сейчас заглушка: `["oracle-main", "oracle-dw", "oracle-reporting"]`. Для реального использования — заменить на чтение из конфига или БД.

### `GET /api/hocon/sample/{name}`
Загружает файл из `src/main/resources/hocon-samples/{name}`. Используется кнопкой "Загрузить пример" (запрашивает `sample-flow.conf`).

### `POST /api/hocon/validate`
Принимает `FlowProcess` JSON, возвращает `{ errors: [], warnings: [] }`. Проверяет: уникальность ID шагов, наличие целевых шагов для переходов.

### `POST /api/hocon/save`
Заглушка. Возвращает `{ status: "ok" }`. Реальное сохранение — на стороне клиента через "Экспорт HOCON".

---

## Backend: модели

### `FlowProcess`
Java record — корневая DTO, передаётся при валидации и сохранении:
```
FlowProcess
  └── List<Variable>  (name, type, value, description, required, constraint{})
  └── List<Step>      (id, name, type, connection, config{}, maxRetries, retryDelayMs)
        └── List<Output>  (to, condition, order)
```

### `StepTypeDescriptor`
Описывает тип шага для динамической генерации формы на клиенте:
- `type` — строковый ключ (ORACLE_PLSQL, HTTP, EMAIL, EMPTY)
- `requiresConnection` — показывать ли поле Connection в форме
- `supportsRetry` — показывать ли Max Retries / Retry Delay
- `fields[]` — список `FieldDescriptor` для генерации полей config
- `hints[]` — текстовые подсказки внизу формы

### `FieldDescriptor`
Поле конфига шага:
- `type`: `text | number | select | textarea`
- `options[]` — для select
- `required`, `placeholder`, `hint`

### `StepTypeRegistry`
In-memory реестр, заполняется в конструкторе. Чтобы добавить новый тип шага — добавить вызов `register(new StepTypeDescriptor(...))` в конструктор.

---

## Frontend: архитектура

Весь UI — SPA на одной странице (`editor.html`). Состояние хранится в JS-объекте `state` в `app.js`. Нет фреймворка, нет сборщика.

### Поток данных

```
HOCON-текст
    ↓ HoconParser.parseHocon()
state.processDraft  { variables[], steps[] }
    ↓ renderAll()
    ├── FlowRenderer.buildFlowMapModel()  → граф { levels[], lines[] }
    ├── FlowRenderer.renderFlowLevel()    → HTML колонок
    ├── FlowRenderer.redrawFlowLines()    → SVG стрелок
    └── HoconSerializer.serializeHocon() → HOCON-текст в поле "Exported HOCON"
```

### `app.js` — главный модуль

Отвечает за:
- **`state`** — единственный источник правды: `processDraft`, `stepEditorDraft`, `sourceEditorDraft`, `parserState`, `renderedFlowLines`
- **`normalizeStep()`** — приводит объект шага к каноническому виду при любом создании/изменении. Всегда использовать при добавлении шагов в `processDraft.steps`
- **`openStepEditor(stepId, options)`** — открывает модальное окно. `options.startsAfterStepId` — кто будет родителем; `options.suggestedLevel` — предлагаемый UI-уровень
- **`saveStepEditorDraft()`** — читает форму через `StepEditor.syncDraftFromDom()`, нормализует, обновляет `processDraft`, вызывает `renderAll()`
- **`renderAll()`** — полная перерисовка: статус-бар, граф, экспорт
- **Событийная модель** — все клики делегируются через `$flowMapColumns.on('click', '[data-action]', ...)`. Действия: `edit`, `duplicate`, `delete`, `add-next`

### `hocon-parser.js`

Парсит HOCON-текст в `{ variables[], steps[] }`.

**Пайплайн:**
```
stripComments()         → убирает # и // комментарии
extractNamedBlock()     → находит блок по имени { }
readBalanced()          → читает вложенные { } с учётом строк
parseVariablesBlock()   → variables {} → массив объектов
parseStepDefinitions()  → steps {} → массив шагов
parseSingleStep()       → один шаг → объект
parseOutputsArray()     → outputs = [...] → массив Output
parseObjectAssignments()→ любой блок → { values, blocks }
```

**Ограничения парсера:**
- Не поддерживает многострочные HOCON-строки (`""" ... """`)
- Не поддерживает include
- Массивы поддерживаются только в `outputs = [...]`
- Значения config читаются как строки

**`ui-layout` блок** — опциональный, хранит явные уровни нод:
```hocon
ui-layout {
  step_id: 2
}
```

### `hocon-serializer.js`

Сериализует `processDraft` обратно в HOCON. Порядок блоков: `variables {}` → `ui-layout {}` (если есть явные уровни) → `steps {}`.

Правила экранирования значений (`formatConfigValue`):
- `true/false/null/числа` — без кавычек
- `UPPERCASE_IDENTIFIERS` — без кавычек
- всё остальное — в JSON-кавычках

### `flow-renderer.js`

Отвечает за топологию графа и SVG.

**`buildFlowMapModel(steps, selectedStepId)`** — основная функция:

1. `findBackEdges(steps)` — DFS обход, находит рёбра-циклы (ребро из ноды к её предку в стеке DFS)
2. `assignLevels(steps, backEdges)` — BFS кратчайшего пути (first-visit). Циклические рёбра пропускаются. Результат: `levelsById { stepId → level }`
3. Применение `step.uiLevel` — явный уровень шага переопределяет вычисленный
4. Классификация рёбер:
   - `toLvl === fromLvl` → **same-level edge** — рисуется горизонтальной SVG-кривой
   - `toLvl < fromLvl` → **backward edge** — добавляется в `backEdges`, рисуется как `↩ step_id [Jump]` в карточке
   - `toLvl > fromLvl` → **forward edge** — рисуется вертикальной SVG-кривой вниз
5. Раскладка по `levelBuckets` → `levels[]`

**`redrawFlowLines()`** — рисует SVG поверх колонок (`z-index: 10`):
- Вертикальные кривые: от нижней грани from-ноды к верхней грани to-ноды (кубический Безье)
- Горизонтальные кривые (same-level): от правой грани к левой (или наоборот)
- Цвета: серый — fallback, синий (`#0b7285`) — conditional, оранжевый (`#b54708`) — missing
- Пунктир — fallback-переходы; сплошная линия — conditional
- Стрелка `marker-end` по касательной к кривой

**`uiLevel` — явный уровень шага:**

Поле `step.uiLevel` (число или `null`) позволяет зафиксировать позицию ноды в колонке. При создании шага кнопкой `+` автоматически предлагается `parent.uiLevel + 1`. Редактируется вручную через поле "UI Level" в модальном окне. Сохраняется в HOCON через блок `ui-layout {}`.

### `step-editor.js`

Рендерит содержимое модального окна редактирования шага.

**`renderStepEditorModal($body, draft, allSteps, typeDescriptor, connections)`** — строит HTML формы:
- Base fields: ID, Name, UI Level, Type, Connection, Max Retries, Retry Delay
- Config section: динамические поля из `typeDescriptor.fields[]` + ручная таблица key/value для нестандартных ключей
- Outputs section: таблица переходов (to, condition). Кнопка `+` создаёт несуществующий шаг как EMPTY
- Type hints: текстовые подсказки из `typeDescriptor.hints[]`

**`syncDraftFromDom(draft, $body)`** — читает текущие значения из DOM в `draft`. Вызывается перед сохранением и перед каждой перерисовкой формы. Также вызывает `cm.save()` для CodeMirror-редакторов.

**CodeMirror** инициализируется в `app.js` после рендера формы на поле с классом `config-sql-editor` (textarea с `id="config-api-sql"`).

### `variables-editor.js`

Простая таблица для переменных процесса. Читается через `VariablesEditor.readVariablesFromDom()` при сохранении шага и при экспорте.

---

## HOCON-формат процесса

```hocon
# Опциональный блок явных уровней для UI
ui-layout {
  step_id: 0
  other_step: 2
}

variables {
  varName {
    type: "string"          # string | integer | boolean | decimal
    value: "default"
    description: "..."
    required: true
    constraint {
      regex: "^\\d{6}$"    # опциональное ограничение
    }
  }
}

steps {
  step_id {
    name = "Human readable name"
    type = ORACLE_PLSQL     # ORACLE_PLSQL | HTTP | EMAIL | EMPTY
    connection = "oracle-main"   # только для ORACLE_PLSQL
    config {
      sql = "BEGIN pkg.proc(:p); END;"
      out-param = "result"
      out-type = STRING
    }
    max-retries = 3
    retry-delay-ms = 2000
    outputs = [
      { to = next_step, condition = "result > 0" }   # conditional
      { to = fallback_step }                          # fallback (без condition)
    ]
  }
}
```

---

## Добавление нового типа шага

1. В `StepTypeRegistry.java` добавить вызов `register(new StepTypeDescriptor(...))` в конструктор
2. `type` — строковый ключ (используется в HOCON и в JS)
3. `requiresConnection: true` — в форме появится dropdown Connection
4. `supportsRetry: true` — в форме появятся поля Max Retries / Retry Delay
5. `fields[]` — поля config: `text | number | select | textarea`. Поле с `key = "sql"` и `type = "textarea"` автоматически получает CodeMirror SQL-редактор
6. Перезапустить сервер — JS подтянет новый тип через `GET /api/step-types/{type}`

---

## Добавление реального источника подключений

Сейчас `GET /api/connections` возвращает захардкоженный список в `ApiController.java`:

```java
@GetMapping("/connections")
public List<String> listConnections() {
    return List.of("oracle-main", "oracle-dw", "oracle-reporting");
}
```

Чтобы подключить реальный источник — заменить тело метода на чтение из `application.yml`, базы данных или внешнего API. Сигнатура не меняется.

---

## Добавление реального сохранения файлов

Сейчас `POST /api/hocon/save` — заглушка. Serialization происходит на клиенте в `hocon-serializer.js`. Для реального сохранения:

1. Изменить `ApiController.save()` — принимает `FlowProcess`, сериализует через `HoconSerializer` (если нужна Java-сериализация) или сохраняет JSON
2. Либо добавить эндпоинт `POST /api/hocon/save-text` — принимает сырой HOCON-текст из клиентского сериализатора
3. В `app.js` функция `$('#save-btn').on('click', ...)` — изменить `data` на `$outputHocon.val()` если передавать текст

---

## Известные ограничения

- Парсер не поддерживает HOCON `include`, `"""..."""`, сложные подстановки `${var}`
- Валидация условий переходов (`condition`) не производится — любая строка принимается
- `POST /api/hocon/save` — заглушка, реального сохранения на диск нет
- Список подключений захардкожен
- Drag-and-drop для изменения уровней нод не реализован (есть поле UI Level в форме)
