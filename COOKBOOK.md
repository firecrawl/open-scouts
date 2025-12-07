# Cookbook: Примеры и Рецепты

В этом документе собраны примеры кода для реализации миграции на стек Python + aiohttp + Ollama + Crawl4AI.

## 1. Структура проекта (Рекомендуемая)

```text
backend/
├── app/
│   ├── __init__.py
│   ├── main.py          # Entry point
│   ├── routes.py        # Маршрутизация
│   ├── database.py      # Управление БД (SQLite/PG)
│   ├── auth.py          # JWT утилиты
│   ├── models.py        # SQLAlchemy Core таблицы
│   └── services/
│       ├── agent.py     # Логика скаута
│       ├── llm.py       # Обертка над Ollama
│       └── scraper.py   # Обертка над Crawl4AI
├── Dockerfile
├── requirements.txt
└── docker-compose.yml
```

## 2. Настройка aiohttp сервера (без FastAPI)

```python
# app/main.py
import logging
from aiohttp import web
from app.routes import setup_routes
from app.database import db_manager

async def init_app():
    app = web.Application()

    # Настройка БД при старте/остановке
    app.on_startup.append(db_manager.connect)
    app.on_cleanup.append(db_manager.disconnect)

    setup_routes(app)
    return app

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    web.run_app(init_app(), port=8000)
```

## 3. Универсальный Database Manager (SQLite + Postgres)

```python
# app/database.py
import os
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

class DatabaseManager:
    def __init__(self):
        self.engine = None
        # Читаем из ENV. Если не задано - используем SQLite файл
        self.db_url = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./scouts.db")

    async def connect(self, app):
        print(f"Connecting to database: {self.db_url}")
        self.engine = create_async_engine(self.db_url, echo=True)

    async def disconnect(self, app):
        if self.engine:
            await self.engine.dispose()

    async def fetch_all(self, query, params=None):
        async with self.engine.connect() as conn:
            result = await conn.execute(text(query), params or {})
            return result.mappings().all()

    async def execute(self, query, params=None):
        async with self.engine.begin() as conn:
            await conn.execute(text(query), params or {})

db_manager = DatabaseManager()
```

## 4. Интеграция Ollama (Async)

Используем библиотеку `ollama` в асинхронном режиме.

```python
# app/services/llm.py
import ollama
import asyncio

class LLMService:
    def __init__(self, model="llama3"):
        self.model = model
        self.client = ollama.AsyncClient(host=os.getenv("OLLAMA_HOST", "http://ollama:11434"))

    async def chat(self, messages):
        """
        messages format: [{'role': 'user', 'content': '...'}]
        """
        response = await self.client.chat(model=self.model, messages=messages)
        return response['message']['content']

    async def generate_json(self, prompt, schema=None):
        """
        Генерация структурированного ответа (JSON).
        В промпте нужно явно попросить JSON.
        """
        messages = [
            {'role': 'system', 'content': 'You are a JSON generator. Output only valid JSON.'},
            {'role': 'user', 'content': prompt}
        ]
        # В более новых версиях Ollama есть параметр format='json'
        response = await self.client.chat(model=self.model, messages=messages, format='json')
        return response['message']['content']
```

## 5. Скрапинг с Crawl4AI

```python
# app/services/scraper.py
from crawl4ai import AsyncWebCrawler

async def scrape_url(url: str):
    async with AsyncWebCrawler(verbose=True) as crawler:
        result = await crawler.arun(url=url)

        if result.success:
            return {
                "title": result.soup.title.string if result.soup.title else "",
                "markdown": result.markdown,
                "url": url
            }
        else:
            return {"error": result.error_message}
```

## 6. Docker Compose Setup

```yaml
# docker-compose.yml
version: '3.8'

services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql+asyncpg://user:pass@db:5432/scouts
      - OLLAMA_HOST=http://ollama:11434
    depends_on:
      - db
      - ollama

  db:
    image: postgres:15
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: scouts
    volumes:
      - pg_data:/var/lib/postgresql/data

  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama

volumes:
  pg_data:
  ollama_data:
```
