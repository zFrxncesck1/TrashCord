/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Flex } from "@components/Flex";
import { Button, TextInput } from "@webpack/common";

interface EmojiTextInputProps {
    value: string;
    onChange(v: string): void;
    onSubmit(v: string): void;
}

export function EmojiTextInput({ value, onChange, onSubmit }: EmojiTextInputProps) {
    const handleSubmit = () => {
        if (value.trim() === "") return;
        onSubmit(value);
    };

    return (
        <Flex flexDirection="row" style={{ alignItems: "center", gap: "10px" }}>
            <TextInput
                style={{ flexGrow: 1 }}
                placeholder="Add pattern"
                value={value}
                onChange={onChange}
                onKeyDown={e => {
                    if (e.key === "Enter") handleSubmit();
                }}
            />
            <Button onClick={handleSubmit}>
                Add
            </Button>
        </Flex>
    );
}