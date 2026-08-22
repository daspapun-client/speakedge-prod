export function batchJoinUrl(batchId: string) {
  return `${window.location.origin}/dashboard/batches?join=${batchId}`;
}

export function batchJoinShareText(title: string) {
  return `Join my SpeakEdge class batch "${title}". Log in and request to join:`;
}
