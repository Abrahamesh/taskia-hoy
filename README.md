# taskia-hoy

Mod de Claude Code: panel lateral con tus tareas de Taskia de hoy, clasificadas
(urgente hoy, vencida reciente, en curso, vieja) con una recomendación por tarea.
Clic en una tarea y Claude la empieza.

Requiere el MCP de Taskia conectado en la sesión (servidor `MCP_TASKIA`).

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

El repositorio es privado: solo se instala para quien tenga acceso de lectura en
GitHub y una credencial de git para github.com en su PC (una llave SSH, o
`gh auth login` seguido de `gh auth setup-git`).

## Modo auto

En modo auto, el revisor de permisos bloquea la llamada que hace el panel por su
cuenta, porque no viene de un mensaje tuyo. Para permitirla, agrega la herramienta
de Taskia a `permissions.allow` en `~/.claude/settings.json`. El ID del servidor
cambia según tu conexión; lo ves en el error del panel.

```json
"permissions": {
  "allow": ["mcp__<id-del-servidor>__agent_what_to_do_today"]
}
```

Esa herramienta solo lee tus tareas del día.

## Uso

- El panel **Taskia · Hoy** se abre solo al iniciar la sesión.
- `/taskia` lo abre y lo recarga.
- ▶ = Claude puede hacerla sola · ○ = solo preparar.
