import { NextRequest } from 'next/server';
import { getCommander } from '../../../lib/scryfall';
import { generateDeck, DEFAULT_SLOT_COUNTS, SlotCounts, ProgressEvent } from '../../../lib/deckBuilder';

export async function POST(req: NextRequest) {
  const { commanderName, budget, slotCounts } = await req.json();

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, data: object) => {
    controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
  };

  const ts = () => new Date().toISOString().slice(11, 23);

  const stream = new ReadableStream({
    async start(controller) {
      const start = Date.now();
      console.log(`[${ts()}] INFO  POST /api/generate-deck`, JSON.stringify({ commanderName, budget, slotCounts }));
      try {
        if (!commanderName || !budget) {
          console.error(`[${ts()}] ERROR Paramètres manquants`);
          send(controller, { type: 'error', message: 'Paramètres manquants' });
          controller.close();
          return;
        }

        const budgetNum = parseFloat(budget);
        if (isNaN(budgetNum) || budgetNum < 10) {
          console.error(`[${ts()}] ERROR Budget invalide : ${budget}`);
          send(controller, { type: 'error', message: 'Budget invalide (minimum 10€)' });
          controller.close();
          return;
        }

        const counts: SlotCounts = { ...DEFAULT_SLOT_COUNTS, ...slotCounts };

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

        const deck = await generateDeck(commander, budgetNum, (event: ProgressEvent) => {
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

        send(controller, { type: 'done', deck });
        console.log(`[${ts()}] INFO  Réponse envoyée (${Date.now() - start}ms total)`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Erreur inconnue';
        console.error(`[${ts()}] ERROR Génération échouée :`, message);
        send(controller, { type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}
