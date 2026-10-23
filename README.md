# taskia-hoy

Mod de Claude Code: panel lateral con tus tareas pendientes de Taskia, agrupadas
por workspace, con una recomendación por tarea. Clic en **Empezar** o
**Preparar** y Claude la arranca.

Qué tareas muestra (no depende de fechas):

- Donde eres **responsable**.
- Solo **hojas** del árbol (las que no tienen subtareas: ahí están las acciones).
  Debajo de cada una se ve de qué tarea padre viene (`↳ Fase 2 › Propuesta`).
- Con **menos de 90%** de avance y **no canceladas**. Las de **90% exacto** se
  cuentan como aprobadas y se ven con su KPI.

Requiere el conector de Taskia conectado en la sesión, llamado `Taskia` o
`MCP_TASKIA` (sin distinguir mayúsculas). El panel solo lee de ese: cualquier
otro conector con las mismas herramientas (por ejemplo `MCP_WEB_TASKIA_DEV`) se
ignora. En la app de escritorio el nombre se busca en la lista de conectores de
la sesión.

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

Solo para quien use **modo auto**. En ese modo Claude bloquea las llamadas que no
salen de un mensaje tuyo, y el panel llama a Taskia por su cuenta. Hay que
permitirle dos herramientas de solo lectura de tu conector de Taskia.

Lo más fácil: pega esto en el chat de Claude (pestaña Code) y abre una sesión nueva.

```text
Agrega a "permissions.allow" en mi archivo ~/.claude/settings.json las herramientas
agent_search_tasks y agent_list_task_children de mi conector de Taskia (el que se
llama Taskia o MCP_TASKIA, no el de dev). Usa el ID real de ese conector en esta
sesión, con el formato mcp__<id>__<herramienta>. No borres nada de lo que ya esté.
```

Si se te olvida, el panel muestra este mismo aviso en lugar de las tareas.

## Uso

- El panel **Taskia · Hoy** se abre solo al iniciar la sesión.
- `/taskia` lo abre y lo recarga.
- Arriba, los workspaces: marca uno o varios (☑) y el panel muestra solo esos;
  **Todos** quita la selección. Se recuerda para la próxima sesión.
- Debajo, los KPIs de lo elegido; el marcado (▸) filtra la lista:
  - **Pendientes:** menos de 90%.
  - **Nuevas:** menos de 60%.
  - **Devueltas:** exactamente 60%.
  - **Aprobadas:** exactamente 90% (no salen en la lista de pendientes).
- Un grupo por workspace; el de más tareas sale abierto, los demás se abren con un clic.
- ▶ = Claude puede hacerla sola · ○ = solo preparar.
