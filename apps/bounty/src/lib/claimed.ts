// Server-side replay guard. The circuit already computes a per-(subject,
// object) nullifier as Poseidon(claim_subject, claim_object), but until
// the on-chain gateway program enforces it we mirror the same uniqueness
// rule here: one claim per (github_user_id, repo) pair.
//
// File-backed so the guard survives Next dev restarts. For a fleet
// deployment swap to a real KV (Redis, sqlite, etc.).

import { existsSync, readFileSync, appendFileSync } from 'node:fs';

const FILE = process.env.CLAIMED_FILE || '/tmp/zkx-snap-claimed.txt';

function key(userId: string | number, repo: string): string {
    return `${userId}:${repo.toLowerCase()}`;
}

export function hasClaimed(userId: string | number, repo: string): boolean {
    if (!existsSync(FILE)) return false;
    const target = key(userId, repo);
    return readFileSync(FILE, 'utf8')
        .split('\n')
        .some((line) => line.trim() === target);
}

export function markClaimed(userId: string | number, repo: string): void {
    appendFileSync(FILE, `${key(userId, repo)}\n`);
}
