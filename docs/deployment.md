# Самостоятельное развёртывание

Нужны Docker Engine с Compose, Python 3 и собственный домен. В примерах используется `verso.example.com`; замените его своим доменом. Для локальной разработки нужен Node.js 22+, PostgreSQL 16 и S3-compatible хранилище.

## Настройка окружения

Скопируйте `.env.example` в `.env` и задайте независимые секреты PostgreSQL, rate limiting и S3. Например, `openssl rand -hex 32` создаёт 64 случайных hex-символа. Пароль в `DATABASE_URL` должен совпадать с `POSTGRES_PASSWORD`. `GARAGE_RPC_SECRET` должен состоять из 64 hex-символов. Задайте `PUBLIC_BASE_URL`, `DOMAIN`, при необходимости `LURG_URL`.

```bash
cp .env.example .env
chmod 600 .env
# Заполните .env своими значениями перед следующими командами.
python3 scripts/configure-storage.py
docker compose build app migrate
docker compose up -d db storage
docker compose run --rm migrate
docker compose --profile standalone up -d app caddy
```

Standalone Caddy занимает порты 80/443, выпускает и обновляет сертификат для `DOMAIN`. DNS должен указывать на сервер. Не включайте этот профиль, если порты заняты другим proxy.

## Существующий reverse proxy

Задайте `VERSO_INGRESS_NETWORK` равным имени собственной Docker-сети reverse proxy. Сеть должна существовать. Override присоединяет к ней только приложение с alias `verso-app`.

```bash
docker compose -f compose.yml -f compose.production.yml build app migrate
docker compose -f compose.yml -f compose.production.yml up -d db storage
docker compose -f compose.yml -f compose.production.yml run --rm migrate
docker compose -f compose.yml -f compose.production.yml up -d app
```

Адаптируйте `infra/nginx-verso.conf.example`: домен, сертификаты, ACME webroot и доверенные proxy. Пример работает с прямыми подключениями; при использовании CDN задайте его актуальные доверенные диапазоны самостоятельно. Прямой доступ из Интернета к приложению, SQL и storage должен быть закрыт. Proxy должен перезаписывать `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` и передавать `Host`. Пример задаёт body limit 33m и read timeout 150s для ограниченной обработки видео. Проверьте конфигурацию перед reload.

## Проверка и обновление

Проверьте `docker compose ps`, `/api/health`, публикацию и чтение собственной тестовой статьи, владельческое редактирование, загрузку медиа и HTTP Range. Выполняйте тесты с записью в отдельной установке. Автоматическое резервное копирование и восстановление описаны в [backup.md](backup.md); systemd-примеры устанавливаются с адаптацией каталога проекта.

Перед обновлением сделайте согласованный backup и проверьте его восстановление в отдельные тома. Примените миграции перед запуском нового приложения. После появления новых типов документов для отката требуется совместимый reader/editor; старый backup не должен перезаписывать более новые публикации.
