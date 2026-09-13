declare module "mailparser" {
  import { Readable } from "stream";
  export interface AddressObject {
    value: Array<{ address: string; name: string }>;
    text: string;
  }
  export interface ParsedMail {
    messageId?: string;
    subject?: string;
    from?: AddressObject;
    to?: AddressObject;
    cc?: AddressObject;
    date?: Date;
    text?: string;
    html?: string | false;
    attachments?: Array<{
      filename?: string;
      contentType: string;
      size: number;
    }>;
    headers?: Map<string, string>;
    inReplyTo?: string;
  }
  export function simpleParser(
    source: string | Buffer | Readable,
    options?: Record<string, unknown>
  ): Promise<ParsedMail>;
}
