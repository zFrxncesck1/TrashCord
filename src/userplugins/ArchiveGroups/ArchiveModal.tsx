/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ModalCloseButton, ModalContent, ModalHeader, ModalProps, ModalRoot, ModalSize, openModalLazy } from "@utils/modal";
import { findComponentByCodeLazy } from "@webpack";
import { GuildActions, GuildMemberCountStore, GuildStore, React, TextInput, useState } from "@webpack/common";

import { settings, unarchiveServer } from "./index";

const GuildIcon = findComponentByCodeLazy("makeIconDimensions", "guild:");

function SearchIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2.2" />
            <path d="M20 20L16.5 16.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
    );
}

function ArchiveIcon({ size = 20 }: { size?: number; }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 5.5C3 4.67 3.67 4 4.5 4h15c.83 0 1.5.67 1.5 1.5v3c0 .83-.67 1.5-1.5 1.5h-15A1.5 1.5 0 0 1 3 8.5v-3ZM4 11h16v7.5c0 .83-.67 1.5-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5V11Zm6.5 2a.5.5 0 0 0-.5.5v2c0 .28.22.5.5.5h3a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 0-.5-.5h-3Z" />
        </svg>
    );
}

function UnarchiveIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 19V7m0 0-4 4m4-4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <path d="M5 3h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}

function ViewIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z" stroke="currentColor" strokeWidth="2" />
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
        </svg>
    );
}

function GuildCard({ guild, onView, onUnarchive }: {
    guild: any;
    onView: () => void;
    onUnarchive: () => void;
}) {
    const [confirmingUnarchive, setConfirmingUnarchive] = useState(false);
    const memberCount = GuildMemberCountStore.getMemberCount(guild.id);
    const joinedDate = guild.joinedAt
        ? new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(new Date(guild.joinedAt))
        : null;

    function handleUnarchiveClick() {
        if (confirmingUnarchive) {
            onUnarchive();
        } else {
            setConfirmingUnarchive(true);
            setTimeout(() => setConfirmingUnarchive(false), 3000);
        }
    }

    return (
        <div className="vc-archive-card">
            <div className="vc-archive-card-accent" />
            <div className="vc-archive-card-icon">
                <GuildIcon guild={guild} size={44} animate={false} />
            </div>
            <div className="vc-archive-card-info">
                <span className="vc-archive-card-name">{guild.name}</span>
                <div className="vc-archive-card-meta">
                    {memberCount != null && (
                        <span className="vc-archive-card-pill vc-archive-pill-members">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                                <circle cx="12" cy="8" r="4" />
                                <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                            </svg>
                            {memberCount.toLocaleString()}
                        </span>
                    )}
                    {joinedDate && (
                        <span className="vc-archive-card-pill vc-archive-pill-date">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="3" y="4" width="18" height="18" rx="2" />
                                <path d="M16 2v4M8 2v4M3 10h18" />
                            </svg>
                            {joinedDate}
                        </span>
                    )}
                </div>
            </div>
            <div className="vc-archive-card-actions">
                <button
                    className="vc-archive-btn vc-archive-btn-view"
                    onClick={onView}
                    title="Jump to server"
                >
                    <ViewIcon />
                    <span>View</span>
                </button>
                <button
                    className={`vc-archive-btn vc-archive-btn-unarchive${confirmingUnarchive ? " vc-archive-btn-confirm" : ""}`}
                    onClick={handleUnarchiveClick}
                    title={confirmingUnarchive ? "Click again to confirm" : "Unarchive server"}
                >
                    <UnarchiveIcon />
                    <span>{confirmingUnarchive ? "Confirm?" : "Unarchive"}</span>
                </button>
            </div>
        </div>
    );
}

export function ArchiveModal({ modalProps }: { modalProps: ModalProps; }) {
    const { archivedServers } = settings.use(["archivedServers"]);
    const [query, setQuery] = useState("");

    const allGuilds = Object.values(GuildStore.getGuilds() || {});
    const archivedGuilds = allGuilds.filter((g: any) => g?.id && archivedServers.includes(g.id.toString()));

    const filteredGuilds = query.trim().length > 0
        ? archivedGuilds.filter((g: any) => g.name?.toLowerCase().includes(query.trim().toLowerCase()))
        : archivedGuilds;

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM} className="vc-archive-modal-root">
            <ModalHeader separator={false} className="vc-archive-modal-header">
                <div className="vc-archive-header-inner">
                    <div className="vc-archive-header-icon">
                        <ArchiveIcon size={18} />
                    </div>
                    <div className="vc-archive-header-text">
                        <span className="vc-archive-header-title">Archived Servers</span>
                        <span className="vc-archive-header-subtitle">
                            {archivedGuilds.length} server{archivedGuilds.length !== 1 ? "s" : ""} archived
                        </span>
                    </div>
                </div>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>

            <ModalContent className="vc-archive-modal-content">
                {archivedGuilds.length > 0 && (
                    <div className="vc-archive-search-wrapper">
                        <div className="vc-archive-search-icon">
                            <SearchIcon />
                        </div>
                        <TextInput
                            placeholder="Search archived servers..."
                            value={query}
                            onChange={setQuery}
                            className="vc-archive-search-input"
                        />
                        {query.length > 0 && (
                            <button
                                className="vc-archive-search-clear"
                                onClick={() => setQuery("")}
                                title="Clear search"
                            >
                                ✕
                            </button>
                        )}
                    </div>
                )}

                <div className="vc-archive-list-container">
                    {archivedGuilds.length === 0 ? (
                        <div className="vc-archive-empty-state">
                            <div className="vc-archive-empty-icon">
                                <ArchiveIcon size={40} />
                            </div>
                            <span className="vc-archive-empty-title">Nothing archived yet</span>
                            <span className="vc-archive-empty-hint">
                                Right-click any server in your list and select <strong>Archive Server</strong> to hide it here.
                            </span>
                        </div>
                    ) : filteredGuilds.length === 0 ? (
                        <div className="vc-archive-empty-state vc-archive-empty-search">
                            <div className="vc-archive-empty-icon">
                                <SearchIcon />
                            </div>
                            <span className="vc-archive-empty-title">No results for "{query}"</span>
                            <span className="vc-archive-empty-hint">Try a different search term.</span>
                        </div>
                    ) : (
                        <div className="vc-archive-guild-list">
                            {filteredGuilds.map((guild: any) => (
                                <GuildCard
                                    key={guild.id}
                                    guild={guild}
                                    onView={() => {
                                        modalProps.onClose();
                                        GuildActions.transitionToGuildSync(guild.id);
                                    }}
                                    onUnarchive={() => unarchiveServer(guild.id)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </ModalContent>
        </ModalRoot>
    );
}

export const openArchiveModal = () =>
    openModalLazy(async () => {
        return modalProps => <ArchiveModal modalProps={modalProps} />;
    });
