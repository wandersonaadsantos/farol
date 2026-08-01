# SSE Infrastructure Implementation Guide

## Phase 3.5: Server-Sent Events for <100ms Latency

**Status:** Planned (deferred to optimize Phase 1-3 frontend impact)

---

## Goal

Replace polling-based progress updates with real-time Server-Sent Events (SSE), reducing latency from 500ms+ to <50ms.

**Impact:**
- Polling/status updates: near-instant feedback
- Review/analysis progress: live step updates
- Chat responses: immediate "thinking" → "generating" transitions
- Session startup: realtime stage progression

---

## Architecture

### Current Polling Flow (Phase 1-3)
```javascript
// Frontend polls every 500ms via GET /api/state
showOp('analysis-123', {title: 'Analyzing...'})
updateOp('analysis-123', {step: 'Reading files...', progress: 25})
// User waits up to 500ms to see update
```

### Target SSE Flow (Phase 3.5)
```javascript
// Backend sends event IMMEDIATELY via /api/operations/123/stream (SSE)
// Frontend subscribes:
const source = new EventSource('/api/operations/123/stream')
source.onmessage = (e) => {
  const {step, progress} = JSON.parse(e.data)
  updateOp('analysis-123', {step, progress})  // <50ms latency
}
```

---

## Implementation Steps

### 1. Backend: Add SSE Endpoint (lib/http-server.js)

```javascript
// Add to http handlers (around line 80+)
if (req.url.startsWith('/api/operations/')) {
  const opId = req.url.split('/')[3]
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  
  const listener = (update) => {
    if (update.id === opId) {
      res.write(`data: ${JSON.stringify(update)}\n\n`)
    }
  }
  
  // Emit operation-state-changed events from engine
  engine.on('operation-update', listener)
  
  req.on('close', () => {
    engine.removeListener('operation-update', listener)
    res.end()
  })
  return
}
```

### 2. Backend: Emit Events from Operation Handlers

**In lib/engine/review.js** (for review/analysis operations):
```javascript
function emitProgress(opId, step, progress) {
  engine.emit('operation-update', {
    id: opId,
    status: 'running',
    step,
    progress,
    timestamp: Date.now()
  })
}

// During analysis:
emitProgress(opId, 'Lendo arquivos…', 20)
emitProgress(opId, 'Analisando com Claude…', 60)
emitProgress(opId, 'Montando relatório…', 90)
```

### 3. Frontend: Replace Polling with SSE (ui/app.js)

```javascript
function subscribeToOp(opId) {
  const source = new EventSource(`/api/operations/${opId}/stream`)
  
  source.onmessage = (e) => {
    const update = JSON.parse(e.data)
    updateOp(opId, update)
  }
  
  source.onerror = () => {
    source.close()
    // Fallback to polling if SSE fails
    console.warn(`SSE failed for ${opId}, using fallback`)
  }
  
  return source
}

// Use when operation starts:
const source = subscribeToOp('analysis-123')
// Store source to close on cancel:
ACTIVE_OPS.get('analysis-123').sse = source
```

### 4. Frontend: Cleanup on Operation End (ui/app.js)

```javascript
function closeOp(opId, result = 'done', message = '') {
  const op = ACTIVE_OPS.get(opId)
  if (op?.sse) {
    op.sse.close()
    delete op.sse
  }
  // ... rest of closeOp logic
}
```

---

## Operations Eligible for SSE

**High Priority (user-visible, frequent updates):**
1. Review/Analysis operations → live progress bar
2. Chat responses → immediate thinking → generating
3. Polling/status checks → queue updates
4. Data loading → download progress

**Medium Priority:**
5. Update checking → version comparison progress
6. Tool execution → doctor/kudos progress
7. Session startup → stage progression

**Low Priority (one-shot, rare updates):**
8. Merge operations → completion event
9. Settings save → confirmation

---

## Benefits Over Polling

| Aspect | Polling (Current) | SSE (Proposed) |
|--------|-------------------|----------------|
| Latency | 500ms avg | <50ms |
| Server load | N requests/min | 1 persistent connection |
| User experience | Stale feedback | Immediate updates |
| Complexity | Simple | Moderate (EventSource API) |
| Browser support | All | All modern (IE11+) |

---

## Fallback Strategy

- SSE unavailable → automatic fallback to polling
- Network drop → EventSource auto-reconnects
- Long-running ops (>30s) → server sends keep-alive comments
- All existing polling logic remains as safety net

---

## Testing

### Manual
```javascript
// Open DevTools → Application → EventSource
// Start an operation (e.g., analysis)
// Watch /api/operations/*** stream in Network tab
// Verify <50ms update latency
```

### Automated
```javascript
// Add to test suite:
test('SSE updates operation progress in <100ms', async () => {
  const sse = new EventSource('/api/operations/test123/stream')
  let received = false
  sse.onmessage = () => { received = true }
  
  engine.emit('operation-update', {id: 'test123', step: 'test', progress: 50})
  
  await sleep(100)
  assert(received, 'Update received within 100ms')
})
```

---

## Estimated Effort

- Backend implementation: 2-3 hours
- Frontend integration: 1-2 hours
- Testing & validation: 1 hour
- Total: **4-6 hours** (can be done incrementally)

---

## Dependencies

- Node.js EventEmitter (already in engine)
- Browser EventSource API (built-in, no polyfill needed)
- No new npm packages required

---

## Rollout Plan

1. **Week 1:** Implement backend SSE endpoint
2. **Week 2:** Integrate frontend for review/analysis operations only
3. **Week 3:** Extend to chat, polling, data loading
4. **Week 4:** Monitor production, gather metrics

**Can be deployed gradually without breaking existing polling logic.**

---

## Future Enhancements

- **Backpressure handling:** limit concurrent SSE connections
- **Message compression:** send delta updates instead of full state
- **Reconnection strategy:** exponential backoff + jitter
- **Metrics:** track p95 latency, connection drop rate
- **WebSocket upgrade:** for bidirectional control (cancel, retry)

---

## Reference

- [MDN EventSource API](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)
- [Server-Sent Events Spec](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [Node.js Stream Documentation](https://nodejs.org/api/stream.html)
