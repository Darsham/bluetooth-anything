import { readFile } from 'node:fs/promises';
import { Command } from 'commander';

const EVIDENCE = new Set(['A', 'B', 'C', 'D']);

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** Basic structural validation. Semantics live in docs/PROTOCOL.md. */
export function validateFingerprint(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const fp = raw as Record<string, any>;

  if (!fp || typeof fp !== 'object') {
    return { ok: false, errors: ['root is not an object'] };
  }
  if (fp.schemaVersion !== 1) {
    errors.push(`schemaVersion must be 1, got ${String(fp.schemaVersion)}`);
  }

  const match = fp.match;
  if (!match || typeof match !== 'object') {
    errors.push('match is missing');
  } else if (!match.namePattern && !Array.isArray(match.serviceUuids)) {
    errors.push('match needs namePattern or serviceUuids');
  }

  const knownTargets = new Set<string>();
  if (Array.isArray(fp.gatt)) {
    for (const service of fp.gatt) {
      for (const c of service?.characteristics ?? []) {
        if (typeof c?.uuid === 'string') knownTargets.add(c.uuid.toLowerCase());
      }
    }
  }

  if (!Array.isArray(fp.commands)) {
    errors.push('commands is missing or not an array');
  } else {
    fp.commands.forEach((cmd: any, i: number) => {
      const where = `commands[${i}]`;
      if (!cmd?.name) errors.push(`${where}.name is missing`);
      if (typeof cmd?.target !== 'string') {
        errors.push(`${where}.target is missing`);
      } else if (!knownTargets.has(cmd.target.toLowerCase())) {
        errors.push(`${where}.target ${cmd.target} is not present in gatt`);
      }
      if (!EVIDENCE.has(cmd?.evidence)) {
        errors.push(`${where}.evidence must be A/B/C/D, got ${String(cmd?.evidence)}`);
      }
      if (typeof cmd?.frame === 'string') {
        const declared = new Set((cmd.params ?? []).map((p: any) => p?.name));
        for (const m of cmd.frame.matchAll(/\{(\w+)\}/g)) {
          if (!declared.has(m[1])) errors.push(`${where}.frame uses {${m[1]}} but no such param is declared`);
        }
      }
      for (const p of cmd?.params ?? []) {
        if (typeof p?.min === 'number' && typeof p?.max === 'number' && p.min > p.max) {
          errors.push(`${where}.params.${p?.name}: min > max`);
        }
      }
    });
  }

  return { ok: errors.length === 0, errors };
}

export function fingerprintCommand(): Command {
  const fingerprint = new Command('fingerprint').description('work with fingerprint files');

  fingerprint
    .command('validate <file>')
    .description('validate a fingerprint JSON file')
    .action(async (file: string) => {
      let raw: unknown;
      try {
        raw = JSON.parse(await readFile(file, 'utf8'));
      } catch (err) {
        console.error(`error: cannot read ${file}: ${(err as Error).message}`);
        process.exit(1);
      }

      const result = validateFingerprint(raw);
      if (result.ok) {
        console.log(`${file}: ok`);
        return;
      }
      console.error(`${file}: invalid`);
      for (const e of result.errors) console.error(`  - ${e}`);
      process.exit(1);
    });

  return fingerprint;
}
