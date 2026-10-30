export type Category = { id: string; name: string; hint: string; icon: string; color: string; bg: string; count?: number };

export type UserBrief = { id: number; name: string; city: string; avatar: string; verified: boolean; isBrand: boolean; brandName: string; rating: number; reviewCount: number; online: boolean };
export type UserFull = UserBrief & { bio: string; interests: string[]; listingCount: number; connectionCount: number; memberSince: string; lastSeen: string };
export type Me = UserFull & { email: string; phone: string; lat: number | null; lng: number | null; hasPassword: boolean; commissionRate: number; authProvider: string; pushEnabled: boolean; needsProfile: boolean };

export type Listing = {
  id: number; title: string; description: string; category: string; price: number; condition: string; brand: string; warranty: string;
  city: string; images: string[]; status: 'active' | 'sold'; views: number; createdAt: string;
  seller: UserBrief; distanceKm: number | null; isFavorite: boolean; isMine: boolean;
};

export type ConnectionState = { status: 'none' | 'sent' | 'received' | 'connected'; connectionId?: number };
export type Person = UserFull & { distanceKm: number | null; connection: ConnectionState };

export type ChatMessage = { id: number; conversationId: number; senderId: number; body: string; type: 'text' | 'location'; createdAt: string; readAt: string | null };
export type Conversation = {
  id: number; other: UserBrief; listing: { id: number; title: string; price: number } | null;
  lastMessage: (ChatMessage & { mine: boolean }) | null; unread: number; updatedAt: string;
};

export type Order = {
  id: number; status: 'requested' | 'accepted' | 'completed' | 'declined' | 'cancelled'; price: number; note: string; createdAt: string;
  role: 'buyer' | 'seller'; listing: Listing; buyer: UserBrief; seller: UserBrief; reviewed: boolean;
};

export type Product = { id: string; title: string; price: number; priceText: string | null; merchant: string; image: string; rating: number | null; reviews: number | null; delivery: string; demo?: boolean };
export type AppNotification = { id: number; type: string; title: string; body: string; data: Record<string, any>; read: boolean; createdAt: string };
export type InviteInfo = { code: string; link: string; message: string; sent: number; joined: { id: number; name: string; joinedAt: string }[] };
