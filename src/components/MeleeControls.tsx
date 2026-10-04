import { useEffect, useState } from "react";
import { Button, Group, Slider, Text } from "@mantine/core";
import type { Project } from "../model";
import type { HoldPreview } from "../holding";

export function MeleeControls({
  stopEpoch,
  project,
  preview,
  onPreview,
}: {
  stopEpoch?: number;
  project: Project;
  preview: HoldPreview;
  onPreview: (p: Partial<HoldPreview>) => void;
}) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    setPlaying(false);
  }, [stopEpoch]);
  useEffect(() => {
    setPlaying(false);
  }, [project.identifier]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const start = performance.now();
    const preparation = project.melee?.requireAim === false ? 0 : Math.PI / 12;
    const swing =
      (project.melee?.requireAim === false ? Math.PI : Math.PI * 1.25) / 15;
    const cycle =
      preparation + Math.max(swing, project.melee?.reload ?? 0.5) + 0.3;
    const tick = (now: number) => {
      const t = (((now - start) / 1000) * 0.5) % cycle;
      if (t < preparation)
        onPreview({ mode: "aim", progress: t / preparation });
      else if (t < preparation + swing)
        onPreview({ mode: "swing", progress: (t - preparation) / swing });
      else onPreview({ mode: "hold", progress: 1 });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [
    playing,
    project.identifier,
    project.melee?.reload,
    project.melee?.requireAim,
  ]);
  return (
    <div className="preview-tools">
      <Button
        size="compact-xs"
        variant="light"
        onClick={() => setPlaying(!playing)}
      >
        {playing ? "暂停近战播放" : "播放近战（半速）"}
      </Button>
      <Text size="10px">
        {preview.mode === "swing"
          ? "挥击"
          : preview.mode === "aim"
            ? "准备"
            : "待机 / 冷却"}
      </Text>
      <Slider
        aria-label="近战动作进度"
        min={0}
        max={1}
        step={0.005}
        value={preview.progress ?? 1}
        disabled={preview.mode === "hold"}
        style={{ flex: 1, minWidth: 80 }}
        onChange={(progress) => {
          setPlaying(false);
          onPreview({ progress });
        }}
      />
      <Group gap={6}>
        <Text size="10px" c="dimmed">
          Swing={String(project.melee?.swing ?? true)} · 冷却{" "}
          {project.melee?.reload ?? 0.5}s · 进度{" "}
          {Math.round((preview.progress ?? 1) * 100)}%
        </Text>
      </Group>
    </div>
  );
}
