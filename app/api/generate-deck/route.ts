import { NextRequest } from 'next/server';
import { getCommander } from '../../../lib/scryfall';
import { generateDeck, ProgressEvent } from '../../../lib/deckBuilder';
import { buildCacheKey, getCached, setCached, getCacheStats } from '../../../lib/cache';
import { parseGenerateDeckInput, ValidationError } from '../../../lib/validation';

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, data: object) => {
    controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
  };

  const ts = () => new Date().toISOString().slice(11, 23);

  const stream = new ReadableStream({
    async start(controller) {
      const start = Date.now();
      try {
        const body = await req.json();
        const { commanderName, budget, slotCounts: counts } = parseGenerateDeckInput(body);
        console.log(`[${ts()}] INFO  POST /api/generate-deck`, JSON.stringify({ commanderName, budget, slotCounts: counts }));

        send(controller, { type: 'progress', step: 'commander' });
        const t0 = Date.now();
        const commander = await getCommander(commanderName);
        console.log(`[${ts()}] INFO  Commander résolu : ${commander.name} (${Date.now() - t0}ms)`);

        if (commander.legalities?.commander !== 'legal') {
          console.warn(`[${ts()}] WARN  ${commanderName} non légal en Commander`);
          send(controller, { type: 'error', message: `${commanderName} n'est pas légal en Commander` });
          controller.close();
          return;
        }

        const cacheKey = buildCacheKey(commander.name, budget, counts);
        const cached = getCached(cacheKey);
        if (cached) {
          const stats = getCacheStats();
          console.log(`[${ts()}] INFO  Cache HIT pour ${commander.name} (${stats.size}/${stats.maxSize} entrées)`);
          send(controller, { type: 'done', deck: cached, fromCache: true });
          controller.close();
          return;
        }

        const deck = await generateDeck(commander, budget, (event: ProgressEvent) => {
          if (event.cardImage) {
            if (event.upgradeOldImage) {
              send(controller, { type: 'upgrade', oldImage: event.upgradeOldImage, newImage: event.cardImage });
            } else {
              send(controller, { type: 'card', image: event.cardImage });
            }
          } else {
            send(controller, { type: 'progress', step: event.step });
          }
        }, counts);

        setCached(cacheKey, deck);
        console.log(`[${ts()}] INFO  Cache MISS stocké (${getCacheStats().size} entrées)`);
        send(controller, { type: 'done', deck });
        console.log(`[${ts()}] INFO  Réponse envoyée (${Date.now() - start}ms total)`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Erreur inconnue';
        const prefix = error instanceof ValidationError ? 'Validation' : 'Génération échouée';
        console.error(`[${ts()}] ERROR ${prefix} :`, message);
        send(controller, { type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
