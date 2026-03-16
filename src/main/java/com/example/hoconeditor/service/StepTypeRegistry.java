package com.example.hoconeditor.service;

import com.example.hoconeditor.model.FieldDescriptor;
import com.example.hoconeditor.model.StepTypeDescriptor;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class StepTypeRegistry {

    private final Map<String, StepTypeDescriptor> registry = new LinkedHashMap<>();

    public StepTypeRegistry() {
        register(new StepTypeDescriptor(
                "ORACLE_PLSQL",
                "Oracle PL/SQL вызов",
                "Выполнение PL/SQL-блока через JDBC-адаптер",
                true, true,
                List.of(
                        new FieldDescriptor("sql", "SQL / PL/SQL блок", "textarea", true,
                                "BEGIN pkg.proc(:param); END;", "Параметры подставляются как :paramName"),
                        new FieldDescriptor("out-param", "Выходной параметр", "text", false,
                                "result", "Имя переменной для результата"),
                        new FieldDescriptor("out-type", "Тип выходного параметра", "select", false,
                                null, null, List.of("STRING", "INTEGER", "DOUBLE", "CLOB"))
                ),
                List.of("connection обязателен для ORACLE_PLSQL",
                        "sql хранится строкой; PL/SQL-синтаксис не валидируется редактором")
        ));

        register(new StepTypeDescriptor(
                "HTTP",
                "HTTP / Web-сервис",
                "Вызов внешнего REST/SOAP сервиса",
                false, true,
                List.of(
                        new FieldDescriptor("method", "HTTP-метод", "select", true,
                                null, null, List.of("GET", "POST", "PUT", "DELETE")),
                        new FieldDescriptor("url", "URL", "text", true,
                                "https://api.example.com/endpoint", "Можно использовать подстановки {varName}"),
                        new FieldDescriptor("body", "Тело запроса", "textarea", false,
                                "{}", "JSON или plain text"),
                        new FieldDescriptor("response-var", "Переменная для ответа", "text", false,
                                "result", "Имя переменной для сохранения результата"),
                        new FieldDescriptor("timeout-ms", "Таймаут (мс)", "number", false,
                                "30000", "По умолчанию 30000"),
                        new FieldDescriptor("headers", "Заголовки", "textarea", false,
                                "Content-Type=application/json", "Формат: key=value, по одному на строку")
                ),
                List.of("URL может содержать подстановки переменных в формате {varName}",
                        "Для POST/PUT body обязателен, но редактор не валидирует это")
        ));

        register(new StepTypeDescriptor(
                "EMAIL",
                "Отправка Email",
                "Уведомление по электронной почте",
                false, false,
                List.of(
                        new FieldDescriptor("to", "Получатель", "text", true,
                                "user@example.com", "Можно использовать подстановки {varName}"),
                        new FieldDescriptor("subject", "Тема", "text", true,
                                "Тема письма", null),
                        new FieldDescriptor("body", "Текст письма", "textarea", true,
                                "Текст...", null),
                        new FieldDescriptor("from", "Отправитель", "text", false,
                                "noreply@company.com", "По умолчанию берётся из системных настроек"),
                        new FieldDescriptor("cc", "Копия", "text", false,
                                null, null),
                        new FieldDescriptor("attachments", "Вложения", "text", false,
                                null, "Через запятую: varName1, varName2")
                ),
                List.of("Все текстовые поля поддерживают подстановки {varName}")
        ));

        register(new StepTypeDescriptor(
                "EMPTY",
                "Пустой / Маршрутный узел",
                "Используйте EMPTY как placeholder или маршрутный узел для ветвлений",
                false, false,
                List.of(),
                List.of("Используйте EMPTY как placeholder или маршрутный узел для ветвлений")
        ));

        register(new StepTypeDescriptor(
                "START",
                "Начало процесса",
                "Точка входа в процесс. Singleton — ровно один на флоу. Нельзя удалить.",
                false, false,
                List.of(),
                List.of("START — singleton. Всегда ровно один в процессе.", "Нет config, connection, retry. Допустимы исходящие переходы.")
        ));

        register(new StepTypeDescriptor(
                "END",
                "Конец процесса",
                "Точка выхода из процесса. Singleton — ровно один на флоу. Нельзя удалить.",
                false, false,
                List.of(),
                List.of("END — singleton. Всегда ровно один в процессе.", "Нет config, connection, retry, outputs.")
        ));
    }

    private void register(StepTypeDescriptor desc) {
        registry.put(desc.type(), desc);
    }

    public List<StepTypeDescriptor> getAll() {
        return List.copyOf(registry.values());
    }

    public StepTypeDescriptor getByType(String type) {
        return registry.get(type);
    }
}
