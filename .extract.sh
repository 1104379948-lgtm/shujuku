#!/bin/bash
mkdir -p /tmp/work
files=(
  "src/presentation-v2/composables/useTemplateRecoveryGuard.ts"
  "src/presentation-v2/composables/visualizer/useVisualizerAssistant.ts"
  "src/presentation-v2/composables/visualizer/useVisualizerConfigEditing.ts"
  "src/presentation-v2/composables/visualizer/useVisualizerSave.ts"
  "src/presentation-v2/stores/visualizer-store.ts"
  "src/presentation-v2/surfaces/visualizer/VisualizerSurface.vue"
  "src/service/chat/chat-service.ts"
  "src/service/runtime/helpers-remaining.ts"
  "src/service/runtime/helpers-table-lock.ts"
  "src/service/table/storage-frame-v2-persist.ts"
  "src/service/table/table-history.ts"
  "src/service/visualizer/visualizer-data-ops.ts"
)
for tag in 4835fa9 db992c4; do
  for f in "${files[@]}"; do
    name=$(basename "$f")
    out="/tmp/work/${tag}_${name}"
    if [ ! -f "$out" ]; then
      git -C /mnt/e/xiangmu/shujuku show "${tag}:${f}" > "$out" 2>/dev/null
    fi
  done
done
ls -la /tmp/work/