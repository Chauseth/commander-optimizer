import { NextRequest, NextResponse } from 'next/server';
import { getCommander, getTaggerOracleTags } from '../../../lib/scryfall';
import { computeSlotCounts } from '../../../lib/formula';

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('commander') ?? '';
  if (!name) return NextResponse.json({ error: 'Nom manquant' }, { status: 400 });

  try {
    const commander = await getCommander(name);
    const oracleTags = await getTaggerOracleTags(commander);
    const { counts, archetype } = computeSlotCounts(commander, oracleTags);
    return NextResponse.json({ counts, archetype });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
