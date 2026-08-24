import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function demoOnlyResponse() {
  return NextResponse.json(
    {
      error: "DEMO_ONLY_FRONTEND",
      message:
        "This frontend is a synthetic demonstration and is not a production client portal. Use the documented Bevoac API through APIM."
    },
    {
      status: 410,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0"
      }
    }
  );
}

export async function GET() {
  return demoOnlyResponse();
}

export async function POST() {
  return demoOnlyResponse();
}
