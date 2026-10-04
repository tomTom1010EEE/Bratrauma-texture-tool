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
  TextInput,
} from "@mantine/core";
import type { Project, Socket, Vec } from "../model";
export function AttachmentsPanel({
  project: p,
  selected,
  select,
  edit,
  choose,
  auto,
  add,
  busy,
}: {
  project: Project;
  selected: string | null;
  select: (id: string) => void;
  edit: (id: string, patch: Partial<Socket>) => void;
  choose: (id: string) => void;
  auto: () => void;
  add: () => void;
  busy: boolean;
}) {
  const s = p.sockets.find((s) => s.id === selected);
  const l = s?.preview?.layers.find((l) => l.id === s.preview?.selected);
  const n = (
    label: string,
    value: number,
    onChange: (v: number) => void,
    step = 1,
  ) => (
    <NumberInput
      size="xs"
      label={label}
      value={value}
      step={step}
      decimalScale={4}
      onChange={(v) => {
        if (typeof v === "number" && Number.isFinite(v)) onChange(v);
      }}
    />
  );
  return (
    <Stack p="sm" gap="sm">
      <Alert color="blue" p="xs">
        配件是独立物品。选择挂点后可在人物或物品组装页拖动紫色挂点；枪械旋转、翻面与持握变化会带动配件。
      </Alert>
      <Group grow>
        <Button
          size="xs"
          variant="light"
          loading={busy}
          onClick={auto}
          disabled={!p.source?.rootId}
        >
          按接纳规则装配预览
        </Button>
        <Button size="xs" variant="default" onClick={add}>
          新增挂点模板
        </Button>
      </Group>
      <Select
        label="容器 / 配件挂点"
        searchable
        value={s?.id || null}
        onChange={(id) => id && select(id)}
        data={p.sockets.map((v, i) => ({
          value: v.id,
          label: `${i + 1}. ${v.name}${v.preview ? " ✓ " + v.preview.identifier : ""}${v.hidden ? "（隐藏）" : ""}`,
        }))}
      />
      {s && (
        <>
          <Code style={{ overflowWrap: "anywhere" }}>
            {s.sourcePath || "新建模板 · 不自动写入容器结构"}
          </Code>
          {s.declaredPosition === false && (
            <Alert color="orange" p="xs">
              源规则尚无 itempos；调整坐标后可补充挂点，不改接纳规则。
            </Alert>
          )}
          <Text size="xs" c="dimmed">
            {s.source === "container"
              ? "容器坐标乘武器 Item.scale"
              : "Containable 坐标是显示像素，不乘武器 Item.scale"}
          </Text>
          <div className="pair">
            {n("挂点 itempos X", s.position[0], (v) =>
              edit(s.id, { position: [v, s.position[1]] }),
            )}
            {n("挂点 itempos Y", s.position[1], (v) =>
              edit(s.id, { position: [s.position[0], v] }),
            )}
          </div>
          {n("挂点 rotation（°）", s.rotation, (rotation) =>
            edit(s.id, { rotation }),
          )}
          <TextInput
            size="xs"
            label="接纳规则（只读源规则 / 新建仅模板）"
            value={s.items}
            readOnly={!!s.sourcePath}
            onChange={(e) => edit(s.id, { items: e.currentTarget.value })}
          />
          <Text size="10px" c="dimmed">
            同一 SubContainer 的多个 Containable
            是候选规则，预览装配时只保留一个。
          </Text>
          <Button size="xs" variant="light" onClick={() => choose(s.id)}>
            {s.preview ? "更换配件 · " + s.preview.identifier : "读取配件贴图"}
          </Button>
          <Checkbox
            size="xs"
            label="隐藏该挂点预览（不回写隐藏开关）"
            checked={s.hidden || false}
            onChange={(e) => edit(s.id, { hidden: e.currentTarget.checked })}
          />
          {s.preview && (
            <>
              <Select
                size="xs"
                label="配件绘制贴图"
                value={s.preview.selected}
                onChange={(selected) =>
                  selected &&
                  edit(s.id, { preview: { ...s.preview!, selected } })
                }
                data={s.preview.layers
                  .filter((l) => l.role !== "decorative")
                  .map((l) => ({
                    value: l.id,
                    label: l.role + " · " + l.name,
                  }))}
              />
              {n(
                "配件预览 scale（不回写配件）",
                s.preview.scale,
                (scale) => {
                  if (scale > 0)
                    edit(s.id, { preview: { ...s.preview!, scale } });
                },
                0.01,
              )}
              {l && (
                <div className="pair">
                  {[0, 1].map((i) => (
                    <div key={i}>
                      {n(
                        "配件 origin " + (i ? "Y" : "X"),
                        l.origin[i],
                        (v) =>
                          edit(s.id, {
                            preview: {
                              ...s.preview!,
                              layers: s.preview!.layers.map((o) =>
                                o.id === l.id
                                  ? {
                                      ...o,
                                      origin: o.origin.map((n, j) =>
                                        j === i ? v : n,
                                      ) as Vec,
                                    }
                                  : o,
                              ),
                            },
                          }),
                        0.01,
                      )}
                    </div>
                  ))}
                </div>
              )}
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={() => edit(s.id, { preview: undefined })}
              >
                卸下预览配件
              </Button>
            </>
          )}
          <Code
            block
          >{`<${s.source === "container" ? "ItemContainer" : "Containable"} itempos="${s.position.join(",")}" ${s.source === "container" ? "itemrotation" : "rotation"}="${s.rotation}" />`}</Code>
          {l && s.preview && (
            <>
              <Text size="xs" c="dimmed">
                配件自身标定片段（需独立导入配件保存，不随枪械跨文件回写）
              </Text>
              <Code
                block
              >{`<Item identifier="${s.preview.identifier}" scale="${s.preview.scale}">\n  <${l.role === "contained" ? "ContainedSprite" : "Sprite"} sourcerect="${l.rect.join(",")}" origin="${l.origin.join(",")}" />\n</Item>`}</Code>
            </>
          )}
        </>
      )}
      {!s && (
        <Text size="xs" c="dimmed">
          先选择已有挂点，或增加用于导出 XML 的挂点模板。
        </Text>
      )}
    </Stack>
  );
}
