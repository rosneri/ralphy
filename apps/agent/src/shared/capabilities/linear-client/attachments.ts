import { linearRequest } from "./request";

interface LinearFileUpload {
  fileUpload: {
    uploadFile: {
      uploadUrl: string;
      assetUrl: string;
      headers: { key: string; value: string }[];
    } | null;
  } | null;
}

export async function uploadFileToLinear(
  apiKey: string,
  input: { filename: string; contentType: string; bytes: Uint8Array },
): Promise<{ assetUrl: string }> {
  const mutation = `mutation FileUpload($filename: String!, $contentType: String!, $size: Int!) {
    fileUpload(filename: $filename, contentType: $contentType, size: $size) {
      uploadFile { uploadUrl assetUrl headers { key value } }
    }
  }`;
  const data = await linearRequest<LinearFileUpload>(apiKey, mutation, {
    filename: input.filename,
    contentType: input.contentType,
    size: input.bytes.byteLength,
  });
  const up = data.fileUpload?.uploadFile;
  if (!up) throw new Error("fileUpload returned no uploadFile payload");

  const headers: Record<string, string> = { "Content-Type": input.contentType };
  for (const h of up.headers) headers[h.key] = h.value;
  const res = await fetch(up.uploadUrl, {
    method: "PUT",
    headers,
    body: input.bytes as BodyInit,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error("Linear file upload PUT failed") as Error & {
      status?: number;
      body?: string;
    };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return { assetUrl: up.assetUrl };
}

export async function createAttachmentForUrl(
  apiKey: string,
  input: { issueId: string; url: string; title: string; subtitle?: string },
): Promise<string> {
  const mutation = `mutation CreateAttachment(
    $issueId: String!, $url: String!, $title: String!, $subtitle: String
  ) {
    attachmentCreate(input: { issueId: $issueId, url: $url, title: $title, subtitle: $subtitle }) {
      success
      attachment { id }
    }
  }`;
  const data = await linearRequest<{
    attachmentCreate: { success: boolean; attachment: { id: string } | null };
  }>(apiKey, mutation, {
    issueId: input.issueId,
    url: input.url,
    title: input.title,
    subtitle: input.subtitle ?? null,
  });
  const id = data.attachmentCreate.attachment?.id;
  if (!id) throw new Error("attachmentCreate returned no attachment id");
  return id;
}

export async function deleteAttachment(apiKey: string, attachmentId: string): Promise<void> {
  const mutation = `mutation DeleteAttachment($id: String!) {
    attachmentDelete(id: $id) { success }
  }`;
  await linearRequest<{ attachmentDelete: { success: boolean } }>(apiKey, mutation, {
    id: attachmentId,
  });
}

interface LinearAttachment {
  id: string;
  url: string;
  sourceType: string | null;
  title: string | null;
}

export const RALPHY_ATTACHMENT_TITLE = "Ralphy";

export async function createRalphyAttachment(
  apiKey: string,
  issueId: string,
  issueUrl: string,
  subtitle: string,
): Promise<string> {
  const mutation = `mutation CreateAttachment(
    $issueId: String!, $url: String!, $title: String!, $subtitle: String!
  ) {
    attachmentCreate(input: { issueId: $issueId, url: $url, title: $title, subtitle: $subtitle }) {
      success
      attachment { id }
    }
  }`;
  const data = await linearRequest<{
    attachmentCreate: { success: boolean; attachment: { id: string } | null };
  }>(apiKey, mutation, {
    issueId,
    url: issueUrl,
    title: RALPHY_ATTACHMENT_TITLE,
    subtitle,
  });
  const attachmentId = data.attachmentCreate.attachment?.id;
  if (!attachmentId) throw new Error("attachmentCreate returned no attachment id");
  return attachmentId;
}

export async function updateAttachmentSubtitle(
  apiKey: string,
  attachmentId: string,
  subtitle: string,
): Promise<void> {
  const mutation = `mutation UpdateAttachment($id: String!, $subtitle: String!) {
    attachmentUpdate(id: $id, input: { subtitle: $subtitle }) { success }
  }`;
  await linearRequest<{ attachmentUpdate: { success: boolean } }>(apiKey, mutation, {
    id: attachmentId,
    subtitle,
  });
}

export async function upsertRalphyAttachment(
  apiKey: string,
  issueId: string,
  issueUrl: string,
  subtitle: string,
): Promise<void> {
  const attachments = await fetchIssueAttachments(apiKey, issueId, {
    titleFilter: RALPHY_ATTACHMENT_TITLE,
  });
  const existing = attachments[0];
  if (existing) {
    await updateAttachmentSubtitle(apiKey, existing.id, subtitle);
  } else {
    await createRalphyAttachment(apiKey, issueId, issueUrl, subtitle);
  }
}

export async function fetchIssueAttachments(
  apiKey: string,
  issueId: string,
  options?: { titleFilter?: string },
): Promise<LinearAttachment[]> {
  const titleFilter = options?.titleFilter;
  const query =
    titleFilter !== undefined
      ? `query IssueAttachments($id: String!, $titleFilter: String!) {
    issue(id: $id) {
      attachments(filter: { title: { eq: $titleFilter } }, first: 25) {
        nodes { id url sourceType title }
      }
    }
  }`
      : `query IssueAttachments($id: String!) {
    issue(id: $id) {
      attachments(first: 25) {
        nodes { id url sourceType title }
      }
    }
  }`;
  const variables: Record<string, unknown> =
    titleFilter !== undefined ? { id: issueId, titleFilter } : { id: issueId };
  const data = await linearRequest<{
    issue: { attachments?: { nodes?: LinearAttachment[] } } | null;
  }>(apiKey, query, variables);
  return data.issue?.attachments?.nodes ?? [];
}

export async function fetchAttachmentsForIssues(
  apiKey: string,
  issueIds: string[],
): Promise<Map<string, LinearAttachment[]>> {
  const out = new Map<string, LinearAttachment[]>();
  if (issueIds.length === 0) return out;

  const query = `query IssuesAttachments($ids: [ID!]!) {
    issues(filter: { id: { in: $ids } }, first: 250) {
      nodes {
        id
        attachments(first: 25) {
          nodes { id url sourceType title }
        }
      }
    }
  }`;
  const data = await linearRequest<{
    issues: { nodes: { id: string; attachments?: { nodes?: LinearAttachment[] } }[] };
  }>(apiKey, query, { ids: issueIds });
  for (const node of data.issues.nodes) {
    out.set(node.id, node.attachments?.nodes ?? []);
  }
  return out;
}

export async function findIssueAttachmentByTitle(
  apiKey: string,
  issueId: string,
  title: string,
): Promise<string | null> {
  const query = `query IssueAttachmentByTitle($id: String!) {
    issue(id: $id) {
      attachments(first: 50) {
        nodes { id title }
      }
    }
  }`;
  const data = await linearRequest<{
    issue: { attachments?: { nodes?: { id: string; title: string | null }[] } } | null;
  }>(apiKey, query, { id: issueId });
  const nodes = data.issue?.attachments?.nodes ?? [];
  const match = nodes.find((n) => n.title === title);
  return match?.id ?? null;
}
