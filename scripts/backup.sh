#!/usr/bin/env bash
# scripts/backup.sh — gecelik cron ile çalıştırılır
set -euo pipefail

STAMP=$(date +%Y%m%d-%H%M%S)
OUT_DIR=/var/backups/macs
mkdir -p "$OUT_DIR"

DB_DUMP="$OUT_DIR/db-$STAMP.sql.gz"
UPLOADS_DUMP="$OUT_DIR/uploads-$STAMP.tar.gz"
DB_DUMP_OK=0
UPLOADS_DUMP_OK=0

# set -e zaten hatada script'i durdurur; bu trap sadece hangi satırın ve
# hangi çalıştırmanın (STAMP) başarısız olduğunu net biçimde stderr'e
# yazar — offsite kopya (rclone) başarısız olursa da bu tetiklenir, yani
# başarısız bir offsite kopya asla "başarılı yedekleme" gibi görünmez.
trap 'echo "[backup.sh] HATA: $STAMP yedeklemesi satır $LINENO'"'"'de başarısız oldu." >&2' ERR

# EXIT trap her koşulda (başarı ya da başarısızlık, script'in hangi
# adımda durduğuna bakılmaksızın) çalışır. İki görevi var:
#  (1) Script bu çalıştırmada başarısız olduysa, bu ÇALIŞTIRMANIN henüz
#      TAMAMLANMAMIŞ (yarım kalmış) kendi dosyalarını siler — ör. pg_dump
#      akış ortasında ölürse gzip'in ürettiği kesik .sql.gz, adıyla iyi
#      bir yedekten ayırt edilemeden 30 gün diskte kalmasın. Bu çalıştırma
#      tamamlanmış bir adımı (ör. dump bitti ama uploads tar'ı patladıysa
#      dump dosyasını) YA DA önceki gecelerin yedeklerini SİLMEZ.
#  (2) Retention prune'u koşulsuz çalıştırır: rclone/offsite adımı
#      arızalansa bile $OUT_DIR sınırsız büyümemeli — dump ve tar zaten
#      diskte tamamlanmış olur, offsite kopyanın başarısı bunu etkilemez.
cleanup_and_prune() {
  local exit_code=$?
  if [ "$exit_code" -ne 0 ]; then
    [ "$DB_DUMP_OK" -eq 1 ] || rm -f "$DB_DUMP"
    [ "$UPLOADS_DUMP_OK" -eq 1 ] || rm -f "$UPLOADS_DUMP"
  fi
  find "$OUT_DIR" -type f -mtime +30 -delete
  exit "$exit_code"
}
trap cleanup_and_prune EXIT

docker compose exec -T db pg_dump -U macs macs | gzip > "$DB_DUMP"
DB_DUMP_OK=1

docker run --rm -v macs_uploads:/data -v "$OUT_DIR":/out alpine \
  tar czf "/out/uploads-$STAMP.tar.gz" -C /data .
UPLOADS_DUMP_OK=1

# Offsite kopya
rclone copy "$OUT_DIR" "macs-backup:macs/$(date +%Y-%m)" --max-age 24h
