"use client";

import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { Storefront } from "@phosphor-icons/react";
import Shop from "@/components/liondesk/Shop";

// Cosmetic shop / gallery (Idea 42). A home for the cosmetics TechHub already
// grants (desk themes, quest badges, track completion titles) and a PREVIEW of a
// future paid only Fang sink. The economy is server authoritative and the
// migration is held, so this surface never grants or debits Fangs: it only lets
// you equip cosmetics you already own (a local preference) and previews where
// paid cosmetics are headed. Never grant Fangs from the client.
export default function TechHubShopPage() {
  return (
    <ProtectedRoute>
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 max-w-4xl mx-auto">
        <BackButton href="/learn/techhub" label="TechHub" />

        <div className="flex items-center gap-3 mb-5 animate-slide-up">
          <Storefront size={34} weight="fill" color="#FFD700" aria-hidden="true" />
          <div>
            <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-wider leading-none">COSMETICS SHOP</h1>
            <p className="text-cream/50 text-sm mt-0.5">Equip what you have earned and preview the Fangs shop. Nothing is bought or spent.</p>
          </div>
        </div>

        <div className="animate-slide-up" style={{ animationDelay: "0.06s" }}>
          <Shop />
        </div>
      </div>
    </ProtectedRoute>
  );
}
