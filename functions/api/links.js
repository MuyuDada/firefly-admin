// GET /api/links  读取博客友链（解析 src/config/friendsConfig.ts）
// PUT /api/links  全量保存友链（只替换 friendsConfig 数组段，文件其余内容原样保留）

import { json, utf8ToB64, getFile, putFile } from "./_gh.js";
import { requireAuth, unauthorized } from "./_auth.js";

const FRIENDS_FILE_DIR = "src/config";
const FRIENDS_FILE_NAME = "friendsConfig.ts";
const ARRAY_MARKER = "export const friendsConfig: FriendLink[] =";

/* ---------- TS 数组段定位 ---------- */

// 返回 { segStart, segEnd, body }：数组 [ 与 ]; 之间的内容（不含两端括号）
export function locateArray(source) {
  const markerAt = source.indexOf(ARRAY_MARKER);
  if (markerAt === -1) return null;
  const open = source.indexOf("[", markerAt + ARRAY_MARKER.length);
  if (open === -1) return null;
  const close = source.indexOf("\n];", open);
  if (close === -1) return null;
  return { segStart: open + 1, segEnd: close, body: source.slice(open + 1, close) };
}

/* ---------- 解析（容忍注释 / 单双引号 / 尾逗号） ---------- */

// 去掉字符串外的注释后按顶层大括号切分对象
export function splitObjects(body) {
  const objs = [];
  let depth = 0;
  let start = -1;
  let inStr = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    const next = body[i + 1];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      const nl = body.indexOf("\n", i);
      if (nl === -1) break;
      i = nl;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = body.indexOf("*/", i);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        objs.push(body.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return objs;
}

// 带区间的对象切分：用于在原数组段内做局部替换（保住注释与格式）
export function splitObjectRanges(body) {
  const out = [];
  let depth = 0;
  let start = -1;
  let inStr = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    const next = body[i + 1];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      const nl = body.indexOf("\n", i);
      if (nl === -1) break;
      i = nl;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = body.indexOf("*/", i);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        out.push({ start, end: i, text: body.slice(start, i + 1) });
        start = -1;
      }
    }
  }
  return out;
}

function pickString(obj, key) {
  const m = obj.match(
    new RegExp(`${key}\\s*:\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|'((?:[^'\\\\]|\\\\.)*)')`),
  );
  if (!m) return "";
  return (m[1] !== undefined ? m[1] : m[2]).replace(/\\(["'\\])/g, "$1");
}

const KNOWN_KEYS = new Set(["title", "imgurl", "desc", "siteurl", "tags", "weight", "enabled"]);
const KEY_LINE_RE = /^([A-Za-z_$][\w$]*)\s*:\s*(.*)$/;

// 单行未知字段（如 recommended / previewurl / recommendedTheme）：原行保留，
// 否则「编辑一条友链」会把博客里这些额外配置写丢
function pickExtras(obj) {
	const extras = [];
	for (const rawLine of obj.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) continue;
		const m = line.match(KEY_LINE_RE);
		if (!m || KNOWN_KEYS.has(m[1])) continue;
		// 值在同一行内闭合才保留（跨行的数组/对象交给原样回写）
		let depth = 0;
		let inStr = null;
		let closed = true;
		const v = m[2];
		for (let i = 0; i < v.length; i++) {
			const ch = v[i];
			if (inStr) {
				if (ch === "\\") i++;
				else if (ch === inStr) inStr = null;
				continue;
			}
			if (ch === '"' || ch === "'" || ch === "`") {
				inStr = ch;
				continue;
			}
			if (ch === "[" || ch === "{" || ch === "(") depth++;
			else if (ch === "]" || ch === "}" || ch === ")") depth--;
			if (depth > 0) closed = false;
		}
		if (!closed) continue;
		extras.push(line);
	}
	return extras;
}

function pickTags(obj) {
  const m = obj.match(/tags\s*:\s*\[([^\]]*)\]/);
  if (!m) return [];
  const tags = [];
  for (const t of m[1].matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)) {
    const v = (t[1] !== undefined ? t[1] : t[2]).replace(/\\(["'\\])/g, "$1").trim();
    if (v) tags.push(v);
  }
  return tags;
}

export function parseLink(obj) {
  const link = {
    title: pickString(obj, "title"),
    imgurl: pickString(obj, "imgurl"),
    desc: pickString(obj, "desc"),
    siteurl: pickString(obj, "siteurl"),
    tags: pickTags(obj),
    weight: Number((obj.match(/weight\s*:\s*(-?\d+)/) || [])[1] || 0),
    enabled: (obj.match(/enabled\s*:\s*(true|false)/) || [])[1] !== "false",
  };
  const extra = pickExtras(obj);
  if (extra.length) link.extra = extra;
  return link;
}

/* ---------- 序列化 ---------- */

const q = (s) => `"${String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// 单个友链对象（不含首行缩进与尾逗号，与源文件风格一致）
function serializeObject(link) {
  const lines = [
    "{",
    `\t\ttitle: ${q(link.title)},`,
    `\t\timgurl: ${q(link.imgurl)},`,
    `\t\tdesc: ${q(link.desc)},`,
    `\t\tsiteurl: ${q(link.siteurl)},`,
    `\t\ttags: [${(link.tags || []).map(q).join(", ")}],`,
    `\t\tweight: ${Number(link.weight) || 0},`,
    `\t\tenabled: ${link.enabled !== false},`,
  ];
  // 保留博客侧额外字段（recommended / recommendedTheme / previewurl 等）
  for (const line of link.extra || []) lines.push("\t\t" + String(line).replace(/^\s+/, ""));
  lines.push("\t}");
  return lines.join("\n");
}

function serializeLink(link) {
  return "\t" + serializeObject(link) + ",";
}

// 未改动的条目：原样回写，保住行内注释与原格式
function rawUnchanged(link, raw) {
  const orig = parseLink(raw);
  const same = ["title", "imgurl", "desc", "siteurl", "weight", "enabled"].every(
    (k) => String(orig[k]) === String(link[k]),
  );
  return same && JSON.stringify(orig.tags) === JSON.stringify(link.tags || []);
}

// 在数组段内做局部替换：只重写改动/新增的条目，其余（含被注释掉的模板条目）原样保留。
// 按 siteurl 匹配原对象，删除 / 重排 / 插入都不会把别人一起重写。
export function applyLinks(body, links) {
  const ranges = splitObjectRanges(body);
  if (!ranges.length) {
    if (!links.length) return body;
    return "\n" + links.map(serializeLink).join("\n") + "\n";
  }
  const byUrl = new Map();
  for (const r of ranges) {
    const url = parseLink(r.text).siteurl;
    if (url && !byUrl.has(url)) byUrl.set(url, r);
  }
  const prefix = body.slice(0, ranges[0].start);
  const suffix = body.slice(ranges[ranges.length - 1].end + 1);
  const parts = links.map((link) => {
    const r = byUrl.get(link.siteurl);
    if (r && rawUnchanged(link, r.text)) {
      byUrl.delete(link.siteurl);
      return r.text;
    }
    return serializeObject(link);
  });
  if (!parts.length) return "\n";
  return prefix + parts.join(",\n\t") + suffix;
}

export function serializeLinks(links, origRaws = []) {
  if (!links.length) return "\n";
  const parts = links.map((link, i) => {
    const raw = typeof origRaws[i] === "string" ? origRaws[i] : origRaws[i]?.text;
    if (raw && rawUnchanged(link, raw)) return "\t" + raw + ",";
    return serializeLink(link);
  });
  return "\n" + parts.join("\n") + "\n";
}

/* ---------- 校验 ---------- */

function normalizeLink(raw) {
  const title = String(raw.title || "").trim();
  const siteurl = String(raw.siteurl || "").trim();
  if (!title) return { error: "友链名称不能为空" };
  if (!/^https?:\/\/.+/.test(siteurl)) return { error: `站点地址不合法：${siteurl || title}` };
  return {
    link: {
      title,
      imgurl: String(raw.imgurl || "").trim(),
      desc: String(raw.desc || "").trim(),
      siteurl,
      tags: (Array.isArray(raw.tags) ? raw.tags : [])
        .map((t) => String(t).trim().replace(/["'\\]/g, ""))
        .filter(Boolean)
        .slice(0, 6),
      weight: Number.isFinite(Number(raw.weight)) ? Math.trunc(Number(raw.weight)) : 0,
      enabled: raw.enabled !== false,
    },
  };
}

/* ---------- 路由 ---------- */

export async function onRequestGet({ request, env }) {
  if (!(await requireAuth(request, env))) return unauthorized();
  let detail;
  try {
    detail = await getFile(env, FRIENDS_FILE_DIR, FRIENDS_FILE_NAME);
  } catch (e) {
    return json({ error: `读取友链配置失败：${e.message}` }, 502);
  }
  const source = new TextDecoder().decode(
    Uint8Array.from(atob(String(detail.content || "").replace(/\s/g, "")), (c) => c.charCodeAt(0)),
  );
  const seg = locateArray(source);
  if (!seg) return json({ error: "friendsConfig.ts 中未找到 friendsConfig 数组，文件格式可能已变更" }, 500);
  const links = splitObjects(seg.body).map(parseLink);
  return json({ links });
}

export async function onRequestPut({ request, env }) {
  if (!(await requireAuth(request, env))) return unauthorized();
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求体不是合法 JSON" }, 400);
  }
  if (!Array.isArray(body.links)) return json({ error: "links 必须是数组" }, 400);

  const links = [];
  for (const raw of body.links) {
    const { link, error } = normalizeLink(raw);
    if (error) return json({ error }, 400);
    links.push(link);
  }

  // 基于远端最新内容做替换，避免覆盖其他文件改动
  let detail;
  try {
    detail = await getFile(env, FRIENDS_FILE_DIR, FRIENDS_FILE_NAME);
  } catch (e) {
    return json({ error: `读取友链配置失败：${e.message}` }, 502);
  }
  const source = new TextDecoder().decode(
    Uint8Array.from(atob(String(detail.content || "").replace(/\s/g, "")), (c) => c.charCodeAt(0)),
  );
  const seg = locateArray(source);
  if (!seg) return json({ error: "friendsConfig.ts 中未找到 friendsConfig 数组，文件格式可能已变更" }, 500);

  const updated = source.slice(0, seg.segStart) + applyLinks(seg.body, links) + source.slice(seg.segEnd);
  try {
    await putFile(
      env,
      FRIENDS_FILE_DIR,
      FRIENDS_FILE_NAME,
      utf8ToB64(updated),
      `友链更新（${links.length} 条）via firefly-cms`,
      detail.sha,
    );
  } catch (e) {
    if (e.status === 409 || e.status === 422) {
      return json({ error: "保存冲突：配置文件刚被其他操作修改，请刷新后重试" }, 409);
    }
    return json({ error: String(e.message) }, 502);
  }
  return json({ saved: links.length }, 200);
}
