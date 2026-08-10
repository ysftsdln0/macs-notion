#!/usr/bin/env bash
# scripts/backup.sh — gecelik cron ile çalıştırılır
set -euo pipefail

STAMP=$(date +%Y%m%d-%H%M%S)
OUT_DIR=/var/backups/macs
mkdir -p "$OUT_DIR"

# set -e zaten hatada script'i durdurur; bu trap sadece hangi adımın ve
# hangi çalıştırmanın (STAMP) başarısız olduğunu net biçimde stderr'e yazar.
trap 'echo "[backup.sh] HATA: $STAMP yedeklemesi satır $LINENO'"'"'de başarısız oldu." >&2' ERR

docker compose exec -T db pg_dump -U macs macs | gzip > "$OUT_DIR/db-$STAMP.sql.gz"
docker run --rm -v macs_uploads:/data -v "$OUT_DIR":/out alpine \
  tar czf "/out/uploads-$STAMP.tar.gz" -C /data .

# Offsite kopya
rclone copy "$OUT_DIR" "macs-backup:macs/$(date +%Y-%m)" --max-age 24h

# 30 günden eski yerel yedekleri temizle
find "$OUT_DIR" -type f -mtime +30 -delete
