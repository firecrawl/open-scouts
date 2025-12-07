# Cookbook: Примеры и Рецепты

## 1. Структура проекта
(См. предыдущие версии, структура остается прежней).

## 2. Аутентификация (JWT Middleware в aiohttp)

```python
# app/middlewares.py
import jwt
from aiohttp import web

SECRET_KEY = "your_secret_key"

@web.middleware
async def auth_middleware(request, handler):
    # Разрешаем публичные роуты
    if request.path.startswith('/api/auth'):
        return await handler(request)

    auth_header = request.headers.get('Authorization')
    if not auth_header:
        return web.json_response({'error': 'Missing authorization header'}, status=401)

    try:
        token = auth_header.split(' ')[1]
        payload = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
        request['user'] = payload # Сохраняем пользователя в request
    except jwt.ExpiredSignatureError:
        return web.json_response({'error': 'Token expired'}, status=401)
    except Exception:
        return web.json_response({'error': 'Invalid token'}, status=401)

    return await handler(request)
```

## 3. Векторный поиск (pgvector + SQLAlchemy Core)

```python
# app/services/vector_store.py
from sqlalchemy import text

async def search_similar_scouts(db, embedding_vector, limit=5):
    # Синтаксис pgvector: <-> (евклидово), <=> (косинусное), <#> (скалярное)
    # Используем <=> для косинусного расстояния
    query = """
        SELECT id, summary_text, 1 - (summary_embedding <=> :embedding) as similarity
        FROM scout_executions
        WHERE status = 'completed'
        ORDER BY summary_embedding <=> :embedding
        LIMIT :limit;
    """

    # embedding_vector должен быть списком float, например [0.1, 0.5, ...]
    # pgvector драйвер (asyncpg) автоматически преобразует список Python в вектор
    return await db.fetch_all(query, {
        "embedding": str(embedding_vector), # Иногда нужно явно приводить к строке '[...]'
        "limit": limit
    })
```

## 4. Замена Realtime на Polling (React Hook)

Вместо `supabase.channel` используем простой хук для опроса.

```typescript
// frontend/hooks/use-polling.ts
import { useEffect, useRef } from 'react';

export function usePolling(callback: () => void, delay: number | null) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay !== null) {
      const id = setInterval(() => savedCallback.current(), delay);
      return () => clearInterval(id);
    }
  }, [delay]);
}

// Пример использования в компоненте
// usePolling(() => {
//   fetchScoutStatus(scoutId);
// }, 5000); // Опрос каждые 5 секунд
```

## 5. SSE для стриминга Чата (aiohttp)

```python
# app/api/chat.py
from aiohttp import web
import json

async def chat_handler(request):
    response = web.StreamResponse(
        status=200,
        reason='OK',
        headers={
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        }
    )
    await response.prepare(request)

    async for chunk in generate_ai_response():
        data = json.dumps({"content": chunk})
        await response.write(f"data: {data}\n\n".encode('utf-8'))

    await response.write_eof()
    return response
```
