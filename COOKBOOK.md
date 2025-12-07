# Cookbook: Примеры и Рецепты

В этом документе собраны примеры кода для реализации миграции на стек Python + aiohttp + Ollama + Crawl4AI (External Service).

## 1. Структура проекта

```text
backend/
├── app/
│   ├── __init__.py
│   ├── main.py          # Entry point
│   ├── database.py      # Управление БД
│   └── services/
│       ├── scraper_client.py   # Клиент к внешнему сервису Crawl4AI
│       └── llm_client.py       # Клиент к внешнему сервису Ollama
├── Dockerfile
├── requirements.txt
└── docker-compose.yml
```

## 2. Docker Compose с внешним скрапером

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
      - CRAWL4AI_URL=http://crawl4ai:11235  # URL сервиса скрапинга
    depends_on:
      - db
      - ollama
      - crawl4ai

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

  # Crawl4AI как отдельный сервис с API
  crawl4ai:
    image: unclecode/crawl4ai:latest
    ports:
      - "11235:11235"  # Стандартный порт API (уточнить в документации образа)
    environment:
      - MAX_CONCURRENT_CRAWLS=5
    shm_size: '2gb'    # Важно для работы браузера

volumes:
  pg_data:
  ollama_data:
```

## 3. Клиент для внешнего сервиса Crawl4AI

Вместо импорта библиотеки, мы делаем HTTP запрос к API сервиса.

```python
# app/services/scraper_client.py
import os
import aiohttp
import logging

logger = logging.getLogger(__name__)

class ScraperClient:
    def __init__(self):
        # URL сервиса из docker-compose
        self.base_url = os.getenv("CRAWL4AI_URL", "http://crawl4ai:11235")

    async def scrape_url(self, url: str):
        """
        Отправляет задачу на скрапинг во внешний сервис.
        """
        async with aiohttp.ClientSession() as session:
            try:
                # Примерный payload для API Crawl4AI (уточнить в документации API)
                payload = {
                    "urls": url,
                    "include_raw_html": False,
                    "bypass_cache": True
                }

                async with session.post(f"{self.base_url}/crawl", json=payload) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        logger.error(f"Scraper service error: {response.status} - {error_text}")
                        return {"error": f"Service unavailable: {response.status}"}

                    data = await response.json()

                    # Предполагаем, что сервис возвращает структуру с полем markdown
                    # Структура ответа может зависеть от версии API
                    result = data.get("results", [{}])[0]
                    return {
                        "title": result.get("metadata", {}).get("title", ""),
                        "markdown": result.get("markdown", ""),
                        "url": url
                    }

            except aiohttp.ClientError as e:
                logger.error(f"Connection to scraper service failed: {e}")
                return {"error": str(e)}

scraper_client = ScraperClient()
```

## 4. Клиент для Ollama (через HTTP)

Можно использовать официальную либу, но для чистоты `aiohttp` подхода можно делать прямые запросы.

```python
# app/services/llm_client.py
import os
import aiohttp
import json

class LLMClient:
    def __init__(self, model="llama3"):
        self.model = model
        self.host = os.getenv("OLLAMA_HOST", "http://ollama:11434")

    async def chat(self, messages):
        url = f"{self.host}/api/chat"
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload) as response:
                if response.status == 200:
                    data = await response.json()
                    return data.get("message", {}).get("content", "")
                else:
                    return f"Error: {response.status}"
```

## 5. Основной сервер aiohttp

```python
# app/main.py
from aiohttp import web
from app.services.scraper_client import scraper_client

async def handle_scrape_test(request):
    data = await request.json()
    url = data.get("url")
    if not url:
        return web.json_response({"error": "URL required"}, status=400)

    # Вызов внешнего сервиса
    result = await scraper_client.scrape_url(url)
    return web.json_response(result)

app = web.Application()
app.add_routes([web.post('/test-scrape', handle_scrape_test)])

if __name__ == '__main__':
    web.run_app(app, port=8000)
```
