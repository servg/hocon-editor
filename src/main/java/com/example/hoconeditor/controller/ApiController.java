package com.example.hoconeditor.controller;

import com.example.hoconeditor.model.FlowProcess;
import com.example.hoconeditor.model.StepTypeDescriptor;
import com.example.hoconeditor.service.HoconFileService;
import com.example.hoconeditor.service.StepTypeRegistry;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.util.*;

@RestController
@RequestMapping("/api")
public class ApiController {

    private final StepTypeRegistry stepTypeRegistry;
    private final HoconFileService hoconFileService;

    public ApiController(StepTypeRegistry stepTypeRegistry, HoconFileService hoconFileService) {
        this.stepTypeRegistry = stepTypeRegistry;
        this.hoconFileService = hoconFileService;
    }

    @GetMapping("/step-types")
    public List<StepTypeDescriptor> listStepTypes() {
        return stepTypeRegistry.getAll().stream()
                .map(StepTypeDescriptor::withoutFields)
                .toList();
    }

    @GetMapping("/step-types/{type}")
    public ResponseEntity<StepTypeDescriptor> getStepType(@PathVariable String type) {
        var desc = stepTypeRegistry.getByType(type);
        if (desc == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(desc);
    }

    @PostMapping("/hocon/validate")
    public Map<String, Object> validate(@RequestBody FlowProcess process) {
        var errors = new ArrayList<String>();
        var warnings = new ArrayList<String>();

        if (process.steps() != null) {
            var ids = new HashSet<String>();
            for (var step : process.steps()) {
                if (step.id() == null || step.id().isBlank()) {
                    errors.add("Шаг без ID");
                }
                if (!ids.add(step.id())) {
                    errors.add("Дублирующийся ID шага: " + step.id());
                }
                if (step.outputs() != null) {
                    for (var out : step.outputs()) {
                        if (out.to() != null && !out.to().isBlank()) {
                            boolean exists = process.steps().stream()
                                    .anyMatch(s -> out.to().equals(s.id()));
                            if (!exists) {
                                warnings.add("Шаг «" + step.id() + "»: переход к несуществующему шагу «" + out.to() + "»");
                            }
                        }
                    }
                }
            }
        }

        return Map.of("errors", errors, "warnings", warnings);
    }

    @PostMapping("/hocon/save")
    public Map<String, String> save(@RequestBody FlowProcess process) {
        // Stub: echo back acknowledgment; serialization is done on the client
        return Map.of("status", "ok", "message", "Сохранено (заглушка)");
    }

    @GetMapping("/connections")
    public List<String> listConnections() {
        return List.of("oracle-main", "oracle-dw", "oracle-reporting");
    }

    @GetMapping("/hocon/sample/{name}")
    public ResponseEntity<String> loadSample(@PathVariable String name) {
        try {
            return ResponseEntity.ok(hoconFileService.loadSample(name));
        } catch (IOException e) {
            return ResponseEntity.notFound().build();
        }
    }
}
