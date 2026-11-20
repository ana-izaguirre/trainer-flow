export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value;
}
