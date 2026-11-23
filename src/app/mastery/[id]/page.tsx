import { Suspense } from "react";
import ProductDetail from "@/components/mastery/ProductDetail";

export default function MasteryProductPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse" aria-busy="true" />}>
      <ProductDetail />
    </Suspense>
  );
}
