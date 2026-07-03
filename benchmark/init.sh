#!/usr/bin/env bash

for taskDirectoryPath in benchmark/tasks/*; do
  if [ -d "$taskDirectoryPath" ]; then
    mkdir -p "$taskDirectoryPath/.pi"
    cat <<'EOF' > "$taskDirectoryPath/.pi/settings.json"
{
  "agentMode": "yolo"
}
EOF
  fi
done
