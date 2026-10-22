#!/usr/bin/env node
/**
 * Local, human-operated review CLI for pending SQL examples.
 * This is the only way an example becomes approved. It is not exposed via MCP.
 *
 *   npm run review -- list
 *   npm run review -- show <id>
 *   npm run review -- approve <id> [--reviewer "Name"] [--notes "..."]
 *   npm run review -- reject <id> [--reviewer "Name"] [--reason "..."]
 *   npm run review -- rejected
 *   npm run review -- seed-demo
 */
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.js';
import { UserFacingError } from '../errors.js';
import { createServices } from '../services/container.js';
import type { ReviewIO } from '../services/reviewService.js';

const USAGE = `Usage: npm run review -- <command> [args]

Commands:
  list                         List pending examples
  show <id>                    Show a pending example in full
  approve <id> [--reviewer NAME] [--notes TEXT]
                               Approve after interactive confirmation (TTY required)
  reject <id> [--reviewer NAME] [--reason TEXT]
                               Reject with a reason after interactive confirmation (TTY required)
  rejected                     List rejection history (audit)
  seed-demo                    Copy the FICTIONAL demo example into the pending queue

Reviewer names are self-reported and not authenticated.`;

function out(text: string): void {
  process.stdout.write(`${text}\n`);
}

function ttyIO(): ReviewIO & { close(): void } {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new UserFacingError(
      'Approval and rejection require an interactive terminal. Run this command directly in a terminal (no piping or redirection).',
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return { print: out, ask: (q) => rl.question(q), close: () => rl.close() };
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      reviewer: { type: 'string' },
      notes: { type: 'string' },
      reason: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, id] = positionals;
  if (values.help || !command) {
    out(USAGE);
    return command ? 0 : 1;
  }

  const { review } = createServices(loadConfig());
  const needId = () => {
    if (!id) throw new UserFacingError(`"${command}" needs an example ID. Run "npm run review -- list".`);
    return id;
  };

  switch (command) {
    case 'list': {
      const { records, problems } = await review.listPending();
      if (records.length === 0) out('No pending examples.');
      for (const r of records) {
        out(`${r.id}  ${r.createdAt}  [${r.domain}]${r.fictional ? ' [FICTIONAL DEMO]' : ''}  ${r.question}`);
      }
      for (const p of problems) out(`! invalid file skipped: ${p.file}: ${p.error}`);
      return 0;
    }
    case 'show':
      out(await review.show(needId()));
      return 0;
    case 'approve': {
      const io = ttyIO();
      try {
        const result = await review.approve(needId(), io, { reviewerName: values.reviewer, notes: values.notes });
        return result ? 0 : 2;
      } finally {
        io.close();
      }
    }
    case 'reject': {
      const io = ttyIO();
      try {
        const result = await review.reject(needId(), io, { reviewerName: values.reviewer, reason: values.reason });
        return result ? 0 : 2;
      } finally {
        io.close();
      }
    }
    case 'rejected': {
      const { records } = await review.listRejected();
      if (records.length === 0) out('No rejected examples.');
      for (const r of records) {
        out(`${r.id}  rejected ${r.review.reviewedAt} by ${r.review.reviewerName} (self-reported): ${r.review.reason}\n    Q: ${r.question}`);
      }
      return 0;
    }
    case 'seed-demo': {
      const ids = await review.seedDemo();
      if (ids.length === 0) {
        out('No demo examples found in context/examples/demo/. Nothing to seed.');
        return 0;
      }
      out(`Created ${ids.length} FICTIONAL pending example(s): ${ids.join(', ')}`);
      out('Review them with "npm run review -- show <id>" and approve or reject with your own name.');
      return 0;
    }
    default:
      out(`Unknown command "${command}".\n\n${USAGE}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`${err instanceof UserFacingError ? err.message : `Unexpected error: ${(err as Error).stack ?? String(err)}`}\n`);
    process.exit(1);
  },
);
