export const es: Record<string, string> = {
  // ── ui.ts ───────────────────────────────────────────────────
  'ui.noProjects': 'No se encontraron proyectos. Crea uno con: acc project create <nombre>',
  'ui.projectsHeading': 'Proyectos',
  'ui.noAgents': 'Sin agentes configurados.',
  'ui.agentsLabel': 'Agentes:',
  'ui.createdLabel': 'Creado:',
  'ui.instructionsLabel': 'instrucciones:',
  'ui.cmdLabel': 'cmd:',
  'ui.agentCount': '{count} agente(s)',

  // ── status.ts ───────────────────────────────────────────────
  'status.brokerNotRunning': 'El broker no est\u00e1 corriendo.',
  'status.startHint': 'Ini\u00e9cialo con: acc broker start',
  'status.heading': 'Estado del Broker',
  'status.statusLabel': 'Estado:',
  'status.peersLabel': 'Peers:',
  'status.pendingLabel': 'Pendientes:',
  'status.messages': '{count} mensaje(s)',
  'status.online': 'en l\u00ednea',
  'status.noPeers': 'No hay peers activos en el proyecto "{project}".',
  'status.peersHeading': 'Peers en "{project}"',

  // ── peers.ts ────────────────────────────────────────────────
  'peers.brokerNotRunning': 'El broker no est\u00e1 corriendo.',
  'peers.noPeers': 'No hay peers activos.',
  'peers.heading': 'Peers Activos',
  'peers.headingProject': 'Peers Activos ({project})',
  'peers.noRole': '(sin rol)',
  'peers.cwdLabel': 'directorio:',
  'peers.branchLabel': 'rama:',
  'peers.summaryLabel': 'resumen:',

  // ── history.ts ──────────────────────────────────────────────
  'history.brokerNotRunning': 'El broker no est\u00e1 corriendo.',
  'history.noMessages': 'No se encontraron mensajes.',
  'history.heading': 'Historial de Mensajes ({project})',

  // ── shared.ts ───────────────────────────────────────────────
  'shared.brokerNotRunning': 'El broker no est\u00e1 corriendo.',
  'shared.keyNotFound': 'Clave "{key}" no encontrada en namespace "{namespace}".',
  'shared.valueLabel': 'Valor:',
  'shared.updatedByLabel': 'Actualizado por:',
  'shared.updatedAtLabel': 'Actualizado el:',
  'shared.noKeys': 'No hay claves en namespace "{namespace}".',
  'shared.keysHeading': 'Claves en "{namespace}"',
  'shared.heading': 'Estado Compartido ({project})',
  'shared.usageLabel': 'Uso:',
  'shared.usageListKeys': '\u2014 listar claves en namespace',
  'shared.usageShowValue': '\u2014 mostrar valor',

  // ── send.ts ─────────────────────────────────────────────────
  'send.brokerNotRunning': 'El broker no est\u00e1 corriendo.',
  'send.cliSummary': 'Usuario CLI enviando un mensaje',
  'send.noAgents': 'No se encontraron agentes con rol "{role}" en el proyecto "{project}".',
  'send.sent': 'Mensaje enviado a {count} agente(s) con rol "{role}".',

  // ── project.ts ──────────────────────────────────────────────
  'project.notFound': 'Proyecto "{name}" no encontrado en {path}',
  'project.alreadyExists': 'El proyecto "{name}" ya existe.',
  'project.created': 'Proyecto "{name}" creado.',
  'project.configAt': 'Config: {path}',
  'project.agentExists': 'Ya existe un agente con rol "{role}" en el proyecto "{name}".',
  'project.agentAdded': 'Agente "{role}" agregado al proyecto "{name}".',
  'project.agentNotFound': 'No hay agente con rol "{role}" en el proyecto "{name}".',
  'project.agentRemoved': 'Agente "{role}" eliminado del proyecto "{name}".',

  // ── up.ts ───────────────────────────────────────────────────
  'up.noRole': 'No hay agente con rol "{role}" en el proyecto "{name}".',
  'up.noAgents': 'El proyecto "{name}" no tiene agentes configurados.',
  'up.addHint': 'Agrega uno con: acc project add-agent {name} --role <r> --cwd <d>',
  'up.tmuxExists': 'La sesi\u00f3n tmux "acc-{name}" ya existe.',
  'up.tmuxHint': 'Ejecuta "acc down {name}" primero, o con\u00e9ctate con: tmux attach -t acc-{name}',
  'up.ensuringBroker': 'Verificando que el broker est\u00e9 activo...',
  'up.brokerFailed': 'Error al iniciar el broker: {error}',
  'up.brokerReady': 'Broker listo.',
  'up.mcpRegistered': 'Servidor MCP registrado (scope usuario).',
  'up.mcpFailed': 'Error al registrar servidor MCP: {error}',
  'up.mcpHint': 'Aseg\u00farate de que "claude" CLI est\u00e9 instalado y disponible en PATH.',
  'up.removedResidual': 'Eliminado residual {path}',
  'up.projectUp': 'Proyecto "{name}" levantado',
  'up.strategyLabel': 'Estrategia:',
  'up.agentsLabel': 'Agentes:',
  'up.attachWith': 'Con\u00e9ctate con:',
  'up.fallbackSpawned': 'Agentes lanzados como procesos en segundo plano.',
  'up.pidsLabel': 'PIDs:',
  'up.stopWith': 'Detener con:',

  // ── down.ts ─────────────────────────────────────────────────
  'down.stopped': 'Detenido',
  'down.alreadyDead': 'Ya muerto',
  'down.killed': 'Eliminado',
  'down.noAgents': 'No se encontraron agentes activos para el proyecto "{name}".',
  'down.summary': 'Detenidos {count} agente(s) de "{name}".',
  'down.brokerNote': 'Broker sigue corriendo (historial y estado compartido preservados).',

  // ── broker ──────────────────────────────────────────────────
  'broker.cleanedStartup': 'Limpiados {count} peer(s) inactivos al iniciar',
  'broker.cleaned': 'Limpiados {count} peer(s) inactivos',
  'broker.listening': 'Escuchando en http://{host}:{port}',
  'broker.portInUse': 'Puerto {port} en uso \u2014 puede que otro broker est\u00e9 corriendo',

  // ── server ──────────────────────────────────────────────────
  'server.ensuringBroker': 'Verificando que el broker est\u00e9 activo...',
  'server.brokerReady': 'Broker listo.',
  'server.project': 'Proyecto: {project}',
  'server.registered': 'Registrado como {name} ({id}) rol="{role}"',
  'server.connected': 'Servidor MCP conectado v\u00eda stdio.',
  'server.polling': 'Polling: id={id} rol={role} proyecto={project}',
  'server.interruptWritten': 'Archivo de interrupci\u00f3n escrito para mensaje de {role}',
  'server.deliveryFailed': 'Todos los m\u00e9todos de entrega fallaron para mensaje de {role}',
  'server.heartbeatFailed': 'Heartbeat fall\u00f3 \u2014 el broker puede estar ca\u00eddo',
  'server.unregistered': 'Desregistrado del broker.',
  'server.fatal': 'Fatal: {error}',

  // ── config command ──────────────────────────────────────────
  'config.langSet': 'Idioma configurado a {lang}.',
  'config.invalidLang': 'Idioma inv\u00e1lido "{lang}". Soportados: en, es.',
};
