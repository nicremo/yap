import { app } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AppRule, EnhancementLevel, FocusInfo, StyleMode } from '../shared/types';

const APP_RULES_FILE = 'app-rules.json';

function getAppRulesPath(): string {
  return path.join(app.getPath('userData'), APP_RULES_FILE);
}

const DEFAULT_APP_RULES: AppRule[] = [
  { appIdentifier: 'com.mitchellh.ghostty', label: 'Ghostty', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'com.googlecode.iterm2', label: 'iTerm2', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'com.apple.Terminal', label: 'Terminal', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'dev.warp.Warp-Stable', label: 'Warp', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'io.alacritty', label: 'Alacritty', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'net.kovidgoyal.kitty', label: 'Kitty', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'co.zeit.hyper', label: 'Hyper', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'com.microsoft.VSCode', label: 'VS Code', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'com.todesktop.230313mzl4w4u92', label: 'Cursor', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'dev.zed.Zed', label: 'Zed', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'com.exafunction.windsurf', label: 'Windsurf', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'com.apple.dt.Xcode', label: 'Xcode', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'com.sublimetext.4', label: 'Sublime Text', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'com.panic.Nova', label: 'Nova', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'com.jetbrains.intellij', label: 'IntelliJ IDEA', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'com.jetbrains.WebStorm', label: 'WebStorm', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'com.jetbrains.pycharm', label: 'PyCharm', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'com.jetbrains.goland', label: 'GoLand', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'com.jetbrains.rubymine', label: 'RubyMine', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'com.jetbrains.PhpStorm', label: 'PhpStorm', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'com.jetbrains.datagrip', label: 'DataGrip', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'com.github.GitHubClient', label: 'GitHub Desktop', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'com.fournova.Tower3', label: 'Tower', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'com.DanPristworker.Fork', label: 'Fork', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'com.axosoft.gitkraken', label: 'GitKraken', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'com.postmanlabs.mac', label: 'Postman', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'com.Kong.insomnia', label: 'Insomnia', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'com.tinyapp.TablePlus', label: 'TablePlus', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'com.egger-apps.Postico2', label: 'Postico', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'eu.dbeaver.enterprise', label: 'DBeaver', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'com.docker.docker', label: 'Docker Desktop', styleMode: 'vibe-coding', enhancementLevel: 'high' },
];

export async function loadAppRules(): Promise<AppRule[]> {
  try {
    const raw = await readFile(getAppRulesPath(), 'utf8');
    return JSON.parse(raw) as AppRule[];
  } catch {
    await saveAppRules(DEFAULT_APP_RULES);
    return DEFAULT_APP_RULES;
  }
}

async function saveAppRules(rules: AppRule[]): Promise<void> {
  const filePath = getAppRulesPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(rules, null, 2)}\n`, 'utf8');
}

export async function addAppRule(rule: AppRule): Promise<AppRule[]> {
  const rules = await loadAppRules();
  const exists = rules.some((r) => r.appIdentifier === rule.appIdentifier);
  if (exists) {
    return rules;
  }
  rules.push(rule);
  rules.sort((a, b) => a.label.localeCompare(b.label));
  await saveAppRules(rules);
  return rules;
}

export async function removeAppRule(appIdentifier: string): Promise<AppRule[]> {
  const rules = await loadAppRules();
  const filtered = rules.filter((r) => r.appIdentifier !== appIdentifier);
  await saveAppRules(filtered);
  return filtered;
}

export async function updateAppRule(appIdentifier: string, styleMode: StyleMode, enhancementLevel: EnhancementLevel): Promise<AppRule[]> {
  const rules = await loadAppRules();
  const rule = rules.find((r) => r.appIdentifier === appIdentifier);
  if (rule) {
    rule.styleMode = styleMode;
    rule.enhancementLevel = enhancementLevel;
    await saveAppRules(rules);
  }
  return rules;
}

export function resolveStyleForApp(
  focusInfo: FocusInfo | undefined,
  rules: AppRule[],
  defaultStyle: StyleMode,
  defaultLevel: EnhancementLevel,
): { styleMode: StyleMode; enhancementLevel: EnhancementLevel; matchedApp?: string } {
  if (!focusInfo?.bundleIdentifier) {
    return { styleMode: defaultStyle, enhancementLevel: defaultLevel };
  }

  const match = rules.find((r) => r.appIdentifier === focusInfo.bundleIdentifier);
  if (match) {
    return { styleMode: match.styleMode, enhancementLevel: match.enhancementLevel, matchedApp: match.label };
  }

  return { styleMode: defaultStyle, enhancementLevel: defaultLevel };
}
