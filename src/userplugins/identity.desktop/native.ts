export async function RequestRandomUser(): Promise<string> {
    const response = await fetch("https://randomuser.me/api");
    const data = await response.json();
    return JSON.stringify(data.results[0]);
}

export async function ToBase64ImageUrl(_: any, data: { imgUrl: string }): Promise<string> {
    const { imgUrl } = data;
    const response = await fetch(imgUrl);
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("Content-Type") || "image/png";
    const base64 = `data:${contentType};base64,${Buffer.from(buffer).toString("base64")}`;
    return JSON.stringify({ data: base64 });
}