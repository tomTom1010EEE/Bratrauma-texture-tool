import { useState } from "react";
import {
  Alert,
  Button,
  Code,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import type { Project } from "../model";

type Plan = {
  planId: string;
  file: string;
  changes: { node: string; attribute: string; before: string; after: string }[];
  warnings: string[];
};
async function post<T>(url: string, data: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error);
  return body;
}
export function SaveBack({
  project,
  reload,
}: {
  project: Project;
  reload: () => void;
}) {
  const [opened, setOpened] = useState(false),
    [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null),
    [error, setError] = useState("");
  const [result, setResult] = useState<{
    backup: string;
    count: number;
  } | null>(null);
  return (
    <>
      <Button
        size="xs"
        variant="light"
        onClick={async () => {
          setOpened(true);
          setPlan(null);
          setError("");
          setResult(null);
          if (!project.source?.writable || !project.source.token) return;
          setBusy(true);
          try {
            setPlan(await post<Plan>("/api/save/preview", { project }));
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        保存回 Mod
      </Button>
      <Modal
        opened={opened}
        onClose={() => !busy && setOpened(false)}
        title="安全回写 · 仅坐标属性"
        size="lg"
      >
        <Stack gap="sm">
          <Alert color="blue">
            仅回写原物品的框选、原点、缩放、位置、角度及绘制深度。不更改
            identifier、槽位规则、伤害、配方、StatusEffect
            或脚本。配件自身的修改需单独导入配件保存。
          </Alert>
          <Text size="xs" style={{ overflowWrap: "anywhere" }}>
            {project.source?.file || "当前是新建模板，没有源 XML。"}
          </Text>
          {!project.source?.writable && (
            <Alert color="orange">
              {project.source?.reason ||
                "来源只读 / 未确认。请从 LocalMods 重新导入；工坊与 Installed 不可回写。"}
            </Alert>
          )}
          {project.source?.writable && !project.source.token && (
            <Alert color="orange">
              旧工程缺少安全来源信息，请下载工程备份后重新导入。
            </Alert>
          )}
          {error && <Alert color="red">{error}</Alert>}
          {plan && !result && (
            <>
              <Text size="sm">
                {plan.changes.length} 项坐标变化 · 确认后生成同目录 .bak 备份
              </Text>
              <ScrollArea.Autosize mah={310}>
                <Stack gap={6}>
                  {plan.changes.map((c, i) => (
                    <Code
                      block
                      key={i}
                    >{`${c.node} / ${c.attribute}\n− ${c.before}\n+ ${c.after}`}</Code>
                  ))}
                </Stack>
              </ScrollArea.Autosize>
              {!!plan.warnings.length && (
                <Alert color="orange" title="以下内容不会写入原 Mod">
                  {plan.warnings.map((w) => (
                    <Text size="xs" key={w}>
                      {w}
                    </Text>
                  ))}
                </Alert>
              )}
            </>
          )}
          {result && (
            <Alert color="teal" title={`已保存 ${result.count} 项坐标`}>
              <Text size="xs" style={{ overflowWrap: "anywhere" }}>
                备份：{result.backup}
              </Text>
              <Text size="xs">
                可用备份恢复原 XML。重新读取来源后可继续下一轮保存。
              </Text>
            </Alert>
          )}
          <Group justify="flex-end">
            {project.source?.rootId && (result || error) && (
              <Button
                size="xs"
                variant="default"
                onClick={() => {
                  setOpened(false);
                  reload();
                }}
              >
                重新读取来源
              </Button>
            )}
            <Button
              size="xs"
              loading={busy}
              disabled={!plan?.changes.length || !!result || !!error}
              onClick={async () => {
                if (!plan) return;
                setBusy(true);
                try {
                  setResult(
                    await post("/api/save/commit", { planId: plan.planId }),
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              确认保存这些坐标
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
