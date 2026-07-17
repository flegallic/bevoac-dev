import { NextResponse } from "next/server";
import { demoDashboardData } from "@/app/lib/demo-data";
import { normalizeBevoacPayload } from "@/app/lib/normalize";

export const dynamic = "force-dynamic";

const defaultApiUrl = "https://apim-bevoac-prod.azure-api.net/v1/health";
const defaultApiKeyHeader = "Ocp-Apim-Subscription-Key";
const defaultAllowedHosts = ["apim-bevoac-prod.azure-api.net"];

type ClientCredentials = {
  apiUrl?: string;
  apiKey?: string;
  apiKeyHeader?: string;
};

function isAllowedUrl(value: string) {
  try {
    const url = new URL(value);
    const allowedHosts = (process.env.BEVOAC_ALLOWED_API_HOSTS ?? defaultAllowedHosts.join(","))
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);

    return url.protocol === "https:" && allowedHosts.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function fetchBevoac({ apiUrl, apiKey, apiKeyHeader }: Required<ClientCredentials>) {
  if (!isAllowedUrl(apiUrl)) {
    return NextResponse.json(
      {
        ...demoDashboardData,
        apiStatus: "fallback",
        apiError: "Only approved HTTPS Bevoac API hosts are allowed"
      },
      { status: 200 }
    );
  }

  const headers = new Headers({
    Accept: "application/json"
  });

  if (apiKey) {
    headers.set(apiKeyHeader, apiKey);
  }

  try {
    const response = await fetch(apiUrl, {
      headers,
      cache: "no-store"
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          ...demoDashboardData,
          apiStatus: "fallback",
          apiError: `Bevoac API returned ${response.status}`
        },
        { status: 200 }
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : { status: await response.text() };

    return NextResponse.json(normalizeBevoacPayload(payload), {
      headers: {
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        ...demoDashboardData,
        apiStatus: "fallback",
        apiError: error instanceof Error ? error.message : "Unable to reach Bevoac API"
      },
      { status: 200 }
    );
  }
}

export async function GET() {
  return fetchBevoac({
    apiUrl: process.env.BEVOAC_API_URL ?? defaultApiUrl,
    apiKey: process.env.BEVOAC_API_KEY ?? "",
    apiKeyHeader: process.env.BEVOAC_API_KEY_HEADER ?? defaultApiKeyHeader
  });
}

export async function POST(request: Request) {
  let body: ClientCredentials = {};

  try {
    body = (await request.json()) as ClientCredentials;
  } catch {
    body = {};
  }

  return fetchBevoac({
    apiUrl: body.apiUrl?.trim() || process.env.BEVOAC_API_URL || defaultApiUrl,
    apiKey: body.apiKey?.trim() || "",
    apiKeyHeader: body.apiKeyHeader?.trim() || defaultApiKeyHeader
  });
}
