# UbiNav - P2 (SIU 25/26)

Prototipo funcional de la P2 basado en la P1 del grupo 14: navegacion urbana manos libres con ecologia distribuida `walker + monitor`.

## Requisitos
- Node.js 18+ (probado en Node 20+)
- npm

## Instalacion
```bash
cd server
npm install
```

## Ejecucion
```bash
cd server
npm start
```

Abrir en navegador:
- `http://localhost:3000/` (selector de rol)
- `http://localhost:3000/walker.html` (movil/receptor de interacciones)
- `http://localhost:3000/monitor.html` (acompanante remoto)

## Flujo rapido de prueba
1. En `walker`, pulsar `Start (1 toque)` para crear sesion.
2. Compartir el `sessionId` con `monitor`.
3. En `monitor`, introducir `sessionId` y pulsar `Join`.
4. Probar interacciones:
   - Inclinacion izquierda/derecha para navegar menu espacial.
   - Inclinacion hacia delante para seleccionar accion.
   - Comandos de voz (`siguiente`, `repite`, `pausa`, `reanuda`, `salir`, `confirmar`).
   - Movimiento corporal para activacion automatica de navegacion.
   - Comandos remotos desde monitor.

## Cobertura de requisitos minimos P2
- Navegar y seleccionar espacial: menu por inclinacion del movil (sin toque).
- Control principal: avanzar/repetir/pausar navegacion.
- Salida o confirmacion: flujo `salir -> confirmar`.
- 3 funcionalidades adicionales:
  1. Vibracion direccional (izquierda/derecha/recto/llegada).
  2. Activacion automatica al detectar movimiento.
  3. Repeticion automatica de indicacion al detectar detencion.
  4. Extra: acompanamiento remoto en tiempo real (monitor).
