# Техническое задание: Миграция Backend на Python (aiohttp)

## 1. Обзор задачи
Необходимо перенести серверную логику проекта **Open Scouts** с Supabase (Postgres + Edge Functions + Auth + Realtime) на собственный Python-бэкенд с открытыми аналогами.
Текущий проект — это Next.js приложение, тесно связанное с экосистемой Supabase.

## 2. Ключевые требования к стеку
*   **Фреймворк**: Использовать **только `aiohttp`**.
    *   ❌ ЗАПРЕЩЕНО: FastAPI, Flask, Django.
    *   ❌ ЗАПРЕЩЕНО: Pydantic (валидацию делать нативными средствами Python или простейшими схемами).
*   **База данных**:
    *   Поддержка **PostgreSQL** (как основная БД).
    *   Возможность переключения на **SQLite** (для локальной разработки/тестов).
    *   Использовать `SQLAlchemy Core` (сырой SQL).
    *   Векторный поиск: `pgvector` (для Postgres) или простая косинусная схожесть (для SQLite).
*   **AI (LLM)**: Переход с OpenAI API на локальный **Ollama**.
*   **Скрапинг**: Переход с Firecrawl на **Crawl4AI**.
    *   **ВАЖНО**: Crawl4AI должен работать как **отдельный внешний сервис** (Docker container).
*   **Инфраструктура**: Docker Compose.

## 3. Архитектура системы
Система состоит из независимых сервисов:
1.  **Frontend**: Next.js (существующий код, требует рефакторинга слоя данных).
2.  **Backend (Python/aiohttp)**:
    *   REST API (замена Supabase REST API).
    *   Auth Service (JWT, замена Supabase Auth).
    *   Scheduler (замена pg_cron).
    *   Scout Worker (замена Edge Functions).
3.  **Database**: PostgreSQL + pgvector.
4.  **AI Service**: Ollama.
5.  **Scraper Service**: Crawl4AI.

## 4. Функциональные блоки и Задачи

### 4.1. База данных
*   Портировать схему таблиц: `scouts`, `scout_executions`, `scout_messages`, `user_preferences`.
*   Реализовать абстракцию для прозрачной работы с Postgres/SQLite.
*   **Векторы**: Реализовать хранение эмбеддингов (размерность зависит от модели Ollama, например `nomic-embed-text` = 768, `llama3` = 4096). **Важно**: OpenAI использует 1536. Потребуется пересчитать или адаптировать схему.

### 4.2. Backend API (aiohttp)
Необходимо заменить автоматический API Supabase на ручные эндпоинты:
*   `POST /api/auth/signup`, `/login`, `/me` (выдача и проверка JWT).
*   `GET/POST/PUT/DELETE /api/scouts`.
*   `GET /api/scouts/{id}/executions`.
*   `POST /api/chat` (конфигуратор скаутов, стриминг ответа).

### 4.3. Агент Скаута (Core Logic)
Логика "думай -> ищи -> читай -> суммируй":
*   Использовать `aiohttp` клиент для общения с Ollama и Crawl4AI.
*   Реализовать защиту от зацикливания и лимиты шагов (как в текущем TS коде).

### 4.4. Frontend Refactoring (Критическая часть)
Так как фронтенд использует `supabase-js`, необходимо переписать слой данных:
*   **Auth**: Заменить `AuthContext` (Supabase) на кастомный провайдер, использующий JWT от Python бэкенда.
*   **Data**: Заменить вызовы `supabase.from('table').select()` на стандартные `fetch('/api/table')`.
*   **Realtime**: Заменить `supabase.channel()` на простой поллинг (опрос сервера раз в 5-10 секунд) или Server-Sent Events (SSE), если позволяет aiohttp. Для начала рекомендуется **поллинг** для упрощения.

## 5. Этапы сдачи
1.  `docker-compose.yml` со всеми сервисами.
2.  Backend на `aiohttp` (Auth + CRUD + Agent).
3.  Обновленный Frontend (или инструкция по его адаптации), отвязанный от Supabase.
