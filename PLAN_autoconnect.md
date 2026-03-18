# План: sample-flow.conf + авто-соединение с END

## Задача 1: Исправить sample-flow.conf

Файл: `src/main/resources/hocon-samples/sample-flow.conf`

Добавить шаг `start` (тип `START`) в начало блока `steps {}`, подключить к `check_balance`.
Добавить шаг `end` (тип `END`) в конец блока `steps {}`.
Добавить `outputs = [{ to = end }]` в `insufficient_balance` и `send_success_email`.

### Итоговый блок steps:

```hocon
steps {

  start {
    name = "Start"
    type = START
    outputs = [
      { to = check_balance }
    ]
  }

  check_balance {
    name = "Проверка баланса в Oracle"
    type = ORACLE_PLSQL
    connection = "oracle-main"
    config {
      sql = "BEGIN pkg_billing.get_balance(:userId, :balance); END;"
      out-param = "balance"
      out-type = STRING
    }
    max-retries = 3
    retry-delay-ms = 2000
    outputs = [
      { to = sufficient_balance, condition = "balance.toLong() >= amount.toLong()" }
      { to = insufficient_balance }
    ]
  }

  sufficient_balance {
    name = "Вызов платежного API"
    type = HTTP
    config {
      method = POST
      url = "https://processing.internal/charge"
      body = "{\"userId\": \"{userId}\", \"amount\": \"{amount}\"}"
      response-var = "chargeResult"
      timeout-ms = 15000
    }
    outputs = [
      { to = send_success_email }
    ]
  }

  insufficient_balance {
    name = "Недостаточный баланс"
    type = EMAIL
    config {
      to = "{userEmail}"
      subject = "Недостаточно средств"
      body = "Ваш баланс: {balance}. Требуется: {amount}."
      from = "billing@company.com"
    }
    outputs = [
      { to = end }
    ]
  }

  send_success_email {
    name = "Успешное уведомление"
    type = EMAIL
    config {
      to = "{userEmail}"
      subject = "Операция выполнена"
      body = "Списание прошло успешно. Результат: {chargeResult}."
      from = "billing@company.com"
    }
    outputs = [
      { to = end }
    ]
  }

  end {
    name = "End"
    type = END
  }

}
```

---

## Задача 2: Авто-соединение висящих выходов с END

Файл: `src/main/resources/static/js/app.js`

### Изменение A — saveStepEditorDraft()

После блока `if (draft.originalId) { ... } else { ... }`, перед строкой:
`state.processDraft.selectedStepId = nextStep.id;`

Вставить:

```js
// Auto-connect: если шаг не END и нет выходов — соединить с END
if (nextStep.type !== 'END') {
    var endStepForAutoConnect = state.processDraft.steps.find(function(s) { return s.type === 'END'; });
    if (endStepForAutoConnect) {
        var savedStep = FlowRenderer.getStepById(state.processDraft.steps, nextStep.id);
        if (savedStep && savedStep.outputs.length === 0) {
            savedStep.outputs.push({ to: endStepForAutoConnect.id, condition: '', order: 0 });
        }
    }
}
```

### Изменение B — обработчик .create-step-btn

Найти строку:
```js
state.processDraft.steps.push(normalizeStep({ id: toId, name: toId, type: 'EMPTY', config: {}, outputs: [], uiLevel: parentLvl != null ? parentLvl + 1 : null }));
```

Заменить на:
```js
var endStepForEmpty = state.processDraft.steps.find(function(s) { return s.type === 'END'; });
var newEmptyOutputs = endStepForEmpty ? [{ to: endStepForEmpty.id, condition: '', order: 0 }] : [];
state.processDraft.steps.push(normalizeStep({ id: toId, name: toId, type: 'EMPTY', config: {}, outputs: newEmptyOutputs, uiLevel: parentLvl != null ? parentLvl + 1 : null }));
```

---

## Правила авто-соединения

- Срабатывает только если END-шаг есть в флоу
- Не срабатывает для шага типа END
- Не срабатывает если у шага уже есть выходы (outputs.length > 0)
