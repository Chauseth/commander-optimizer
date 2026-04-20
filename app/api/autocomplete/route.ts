import { NextRequest, NextResponse } from 'next/server';
import { autocomplete } from '../../../lib/scryfall';

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q') || '';
  if (query.length < 2) return NextResponse.json([]);
  const suggestions = await autocomplete(query);
  return NextResponse.json(suggestions.slice(0, 8));
}
