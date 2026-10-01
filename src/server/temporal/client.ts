import { Client, Connection } from "@temporalio/client";

let client: Client;

export async function getTemporalClient(): Promise<Client> {
  if (client) return client;
  const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS || "localhost:7233" });
  client = new Client({ connection });
  return client;
}
