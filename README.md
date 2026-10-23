# taskia-hoy

Mod de Claude Code: panel lateral con tus tareas de Taskia de hoy, clasificadas
(urgente hoy, vencida reciente, en curso, vieja) con una recomendación por tarea.
Clic en una tarea y Claude la empieza.

Requiere el conector de Taskia llamado exactamente `MCP_TASKIA` conectado en la
sesión. El panel solo lee de ese: cualquier otro conector con las mismas
herramientas (por ejemplo `MCP_WEB_TASKIA_DEV`) se ignora. En la app de
escritorio el nombre se busca en la lista de conectores de la sesión.

## Instalación

En el prompt de una sesión de Claude Code en terminal:

```
/plugin install taskia-hoy --marketplace Abrahamesh/taskia-hoy
```

Responde `y` para agregar el marketplace y luego elige el scope (Enter para el de usuario).

Desde una shell:

```bash
claude plugin install taskia-hoy --marketplace Abrahamesh/taskia-hoy
```

En la app de escritorio, donde `/plugin` no funciona: clic en **+** junto al
cuadro del prompt → **Plugins** → **Add marketplace** con `Abrahamesh/taskia-hoy`
→ **Add plugin**.

## Perfil

El panel no supone a qué te dedicas. Al clasificar las tareas:

- **Rol:** lo deduce de los workspaces y los nombres de tus tareas. Si quieres
  afinarlo, llena la opción **Perfil** del mod (ej.: "coordinador de logística
  de una empresa de transporte").
- **▶ "la hago yo":** solo marca las tareas que Claude puede avanzar con los
  conectores que tengas conectados en esa sesión.

La opción se pide al instalar el mod. Para cambiarla después, en
`~/.claude/settings.json`:

```json
"pluginConfigs": {
  "taskia-hoy@taskia-hoy": { "options": { "perfil": "coordinador de logística de una empresa de transporte" } }
}
```

Ese archivo es de tu usuario de Windows, no de tu cuenta de Claude: si usas dos
cuentas de Claude en la misma PC, las dos comparten el perfil. Ahí conviene
dejarlo vacío.

## Modo auto

En modo auto, el revisor de permisos bloquea las llamadas que hace el panel por su
cuenta, porque no vienen de un mensaje tuyo. Para permitirlas, agrégalas a
`permissions.allow` en `~/.claude/settings.json`. El ID del servidor cambia según
tu conexión; lo ves en el error del panel.

```json
"permissions": {
  "allow": [
    "mcp__<id-del-servidor>__agent_what_to_do_today",
    "mcp__ccd_connectors__session_connectors_status"
  ]
}
```

La primera solo lee tus tareas del día; la segunda solo lee la lista de
conectores de la sesión (en la app de escritorio, para encontrar `MCP_TASKIA`).

## Uso

- El panel **Taskia · Hoy** se abre solo al iniciar la sesión.
- `/taskia` lo abre y lo recarga.
- ▶ = Claude puede hacerla sola · ○ = solo preparar.
