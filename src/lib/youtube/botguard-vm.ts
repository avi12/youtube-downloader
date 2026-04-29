const WAA_API_KEY = "AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw";

export function getBotGuardVm(name: string) {
  const entry = Object.getOwnPropertyDescriptor(globalThis, name)?.value;
  return entry !== null && typeof entry === "object" && "a" in entry ? entry : null;
}

export async function loadBotGuardInterpreter(interpreterUrl: string) {
  const url = new URL(interpreterUrl, location.href).href;
  await new Promise<void>((resolve, reject) => {
    const elScript = document.createElement("script");
    elScript.src = url;
    elScript.onload = () => resolve();
    elScript.onerror = () => reject(new Error("Failed to load BotGuard interpreter"));
    document.head.append(elScript);
  });
}

export async function waitForBotGuardVm(globalName: string) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (getBotGuardVm(globalName)) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

export async function fetchIntegrityToken(requestKey: string, snapshotResponse: unknown) {
  const integrityResponse = await fetch("https://www.youtube.com/api/jnn/v1/GenerateIT", {
    method: "POST",
    headers: {
      "content-type": "application/json+protobuf",
      "x-goog-api-key": WAA_API_KEY
    },
    body: JSON.stringify([requestKey, snapshotResponse])
  });

  const integrityData = await integrityResponse.json();
  if (!integrityData[0]) {
    throw new Error("No integrity token received");
  }

  return String(integrityData[0]);
}
