import { NextRequest, NextResponse } from 'next/server';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';

export async function POST(req: NextRequest) {
  try {
    const { agent_id } = await req.json();
    if (!agent_id) {
      return NextResponse.json({ error: 'agent_id required' }, { status: 400 });
    }
    if (!ELEVENLABS_API_KEY) {
      return NextResponse.json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 500 });
    }

    const res = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agent_id}`,
      { headers: { 'xi-api-key': ELEVENLABS_API_KEY } }
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `ElevenLabs error: ${res.status}`, detail: text }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json({ signed_url: data.signed_url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
