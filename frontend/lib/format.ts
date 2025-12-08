export function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / 1024 ** index;
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[index]}`;
}

export function statusColor(bucket: string): string {
  switch (bucket) {
    case "success":
      return "green";
    case "redirect":
      return "yellow";
    case "client_error":
      return "orange";
    case "server_error":
      return "red";
    default:
      return "gray";
  }
}
