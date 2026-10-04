import { useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Code,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import type { Project, Vec } from "../model";
import { round } from "../model";
import { calibrationXml } from "../exporter";
import { isCombinedEquipment } from "../../shared/equipment.mjs";
import {
  formatPose,
  heldSlots,
  poseBool,
  poseNumber,
  poseVector,
  type HoldPreview,
} from "../holding";

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
}) {
  return (
    <NumberInput
      size="xs"
      label={label}
      value={round(value)}
      step={step}
      min={min}
      decimalScale={4}
      onChange={(n) => {
        if (typeof n === "number" && Number.isFinite(n))
          onChange(Math.max(min ?? -Infinity, n));
      }}
    />
  );
}
export function HoldingPanel({
  project: p,
  preview,
  onProject,
}: {
  project: Project;
  preview: HoldPreview;
  onProject: (p: Partial<Project>) => void;
}) {
  const [preset, setPreset] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const combined = isCombinedEquipment(p);
  const pose = (key: string, value: number | Vec | boolean) =>
    onProject({
      pose: {
        ...p.pose,
        [key]: typeof value === "boolean" ? String(value) : formatPose(value),
      },
    });
  const pair = (key: "holdpos" | "aimpos" | "handle1" | "handle2") => {
    const v = key.startsWith("handle")
      ? p[key as "handle1" | "handle2"]
      : poseVector(p, key);
    const change = (value: Vec) =>
      key.startsWith("handle") ? onProject({ [key]: value }) : pose(key, value);
    return (
      <div className="pair">
        <NumberField
          label={`${key} X`}
          value={v[0]}
          onChange={(x) => change([x, v[1]])}
        />
        <NumberField
          label={`${key} Y`}
          value={v[1]}
          onChange={(y) => change([v[0], y])}
        />
      </div>
    );
  };
  return (
    <>
      <section className="inspector-section">
        <Stack gap="sm">
          <Text size="xs" fw={650}>
            实时持握 ·{" "}
            {p.holdableType === "MeleeWeapon"
              ? preview.mode === "swing"
                ? "近战挥击"
                : preview.mode === "aim"
                  ? "近战准备 aimpos"
                  : "近战待机 holdpos"
              : preview.mode === "aim"
                ? "瞄准 aimpos"
                : "静态 holdpos"}
          </Text>
          {p.holdableType === "MeleeWeapon" && (
            <Alert color="orange" p="xs">
              近战准备不使用枪械瞄准方向。抬手角度由动作进度控制；holdangle +
              aimangle 是额外物品旋转。挥击可播放/逐帧预览，SwingPos
              使用物理单位；不回写 SwingForce、Reload 等攻击行为。
            </Alert>
          )}
          {combined ? (
            <Alert color="teal" p="xs" fz="xs">
              复合装备 · {p.slots}。穿戴时隐藏 Item
              主图，衣片跟随各自肢体；炮管衣片随前臂持握姿态运动。选衣片可拖动原点、Alt＋滚轮缩放；橙色物理原点调持握位置，握点模式调
              H1 / H2 / 枪口。 衣片原点不等于物品物理原点；Item scale 仍影响握点
              / 枪口，不缩放穿戴衣片。
            </Alert>
          ) : (
            <Text size="xs" c="dimmed">
              人物画布拖动物品调位置；切换“原点”可移动贴图而不移动物品坐标。Alt
              + 滚轮调实际缩放。
            </Text>
          )}
          <NumberField
            label="主贴图 scale（Item）"
            value={p.itemScale}
            min={0.001}
            step={0.01}
            onChange={(itemScale) => onProject({ itemScale })}
          />
          <Checkbox
            size="xs"
            disabled={combined}
            label="双手持握"
            checked={p.twoHanded}
            onChange={(e) =>
              onProject({
                twoHanded: e.currentTarget.checked,
                holdableSlots: e.currentTarget.checked
                  ? "Any,RightHand+LeftHand"
                  : "Any,RightHand,LeftHand",
              })
            }
          />
          <Select
            size="xs"
            disabled={combined}
            label="持握 slots"
            value={heldSlots(p)}
            data={Array.from(
              new Set([
                heldSlots(p),
                ...(p.twoHanded
                  ? ["Any,RightHand+LeftHand"]
                  : [
                      "Any,RightHand,LeftHand",
                      "Any,RightHand",
                      "Any,LeftHand",
                    ]),
              ]),
            )}
            onChange={(v) => {
              if (v) onProject({ holdableSlots: v });
            }}
          />
        </Stack>
      </section>
      <section className="inspector-section">
        <Stack gap="sm">
          <Text size="xs" fw={650}>
            静态位置与角度
          </Text>
          {pair("holdpos")}
          <NumberField
            label="holdangle（°）"
            value={poseNumber(p, "holdangle")}
            onChange={(v) => pose("holdangle", v)}
          />
          <Text size="10px" c="dimmed">
            肩部 → 物品原点；Y 向上，不乘 Item scale。holdpos 随 holdangle
            与躯干一起旋转。
          </Text>
          <Text size="xs" fw={650}>
            瞄准位置与角度
          </Text>
          {pair("aimpos")}
          <NumberField
            label="aimangle（°）"
            value={poseNumber(p, "aimangle")}
            onChange={(v) => pose("aimangle", v)}
          />
          <Text size="10px" c="dimmed">
            {p.holdableType === "MeleeWeapon"
              ? "准备时 aimpos 随抬手角度旋转，而非准星。充分准备 hitPos=45°，物品角度还叠加 holdangle + hitPos + aimangle。"
              : "aimpos 随瞄准方向旋转；aimangle 额外转动物品，不额外旋转 aimpos。0,0 会禁用瞄准姿态。"}
          </Text>
          <Group gap={5} grow>
            <Button
              size="compact-xs"
              variant="default"
              onClick={() =>
                onProject({
                  pose: {
                    ...p.pose,
                    aimpos: p.pose.holdpos || "0,0",
                    aimangle: "0",
                  },
                })
              }
            >
              静态位置 → 瞄准
            </Button>
            <Button
              size="compact-xs"
              variant="default"
              onClick={() =>
                onProject({
                  pose: { ...p.pose, holdpos: p.pose.aimpos || "0,0" },
                })
              }
            >
              瞄准位置 → 静态
            </Button>
          </Group>
          <Checkbox
            size="xs"
            label="aimable · 允许随准星瞄准"
            checked={poseBool(p, "aimable", true)}
            onChange={(e) => pose("aimable", e.currentTarget.checked)}
          />
          <Checkbox
            size="xs"
            label="controlpose · 控制人物姿态"
            checked={poseBool(p, "controlpose")}
            onChange={(e) => pose("controlpose", e.currentTarget.checked)}
          />
          <Checkbox
            size="xs"
            label="usehandrotationforholdangle · 随手旋转"
            checked={poseBool(p, "usehandrotationforholdangle")}
            onChange={(e) =>
              pose("usehandrotationforholdangle", e.currentTarget.checked)
            }
          />
          <Button
            variant="subtle"
            size="compact-xs"
            onClick={() =>
              onProject({
                pose: {
                  ...p.pose,
                  holdpos: "40,-15",
                  aimpos: "45,0",
                  usehandrotationforholdangle: "false",
                },
              })
            }
          >
            启用固定持握（重设位置）
          </Button>
        </Stack>
      </section>
      <section className="inspector-section">
        <Stack gap="sm">
          <Text size="xs" fw={650}>
            握点 / 未缩放贴图像素
          </Text>
          {pair("handle1")}
          {pair("handle2")}
          <Text size="10px" c="dimmed">
            H1 对应右手，H2 对应左手。单手左手预览也使用
            H2；人物与图集中的握点均可拖动。
          </Text>
        </Stack>
      </section>
      {!!p.posePresets?.length && (
        <section className="inspector-section">
          <Stack gap="sm">
            <Text size="xs" fw={650}>
              源 XML 姿态片段（{p.posePresets.length}）
            </Text>
            <Select
              size="xs"
              label="选择 StatusEffect 赋值片段"
              searchable
              clearable
              value={preset}
              onChange={setPreset}
              data={p.posePresets.map((s, i) => ({
                value: String(i),
                label: `${i + 1}. ${s.name}`,
              }))}
            />
            {preset !== null && p.posePresets[Number(preset)] && (
              <Code block>
                {Object.entries(p.posePresets[Number(preset)].values)
                  .map(([k, v]) => `${k}="${v}"`)
                  .join("\n")}
              </Code>
            )}
            <Button
              size="xs"
              variant="default"
              disabled={preset === null || !p.posePresets[Number(preset)]}
              onClick={() => {
                const selected = p.posePresets?.[Number(preset)];
                if (!selected) return;
                const changes: Partial<Project> = { pose: { ...p.pose } };
                for (const [k, v] of Object.entries(selected.values)) {
                  if (k === "handle1" || k === "handle2") {
                    const n = v.split(",").map(Number);
                    if (n.length === 2 && n.every(Number.isFinite))
                      changes[k] = [n[0], n[1]];
                  } else if (k === "slots") {
                    changes.holdableSlots = v;
                    changes.twoHanded =
                      /RightHand\+LeftHand|LeftHand\+RightHand/i.test(v);
                  } else if (
                    [
                      "holdpos",
                      "aimpos",
                      "holdangle",
                      "aimangle",
                      "aimable",
                      "controlpose",
                      "usehandrotationforholdangle",
                    ].includes(k)
                  )
                    changes.pose![k] = v;
                }
                onProject(changes);
              }}
            >
              应用片段到当前标定（可撤销）
            </Button>
            <Text size="10px" c="orange">
              仅应用所列值；不执行条件、延迟或 Lua，也不自动合并其他片段。DDA /
              九州的运行时姿态可能还被其他效果覆盖。
            </Text>
          </Stack>
        </section>
      )}
      <section className="inspector-section">
        <Stack gap="sm">
          <Text size="xs" fw={650}>
            实时返回 · XML 标定字段
          </Text>
          <Code block data-testid="live-calibration-xml" className="live-xml">
            {calibrationXml(p)}
          </Code>
          <Button
            size="xs"
            variant="light"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(calibrationXml(p));
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? "已复制" : "复制标定参数"}
          </Button>
          <Alert p="xs" color="blue" fz="xs">
            关节静态 IK 预览，不模拟碰撞、摆动、后坐力、游泳身体转向或
            Lua。红色连线表示手臂够不到，游戏内会发生位置偏离。
          </Alert>
        </Stack>
      </section>
    </>
  );
}
