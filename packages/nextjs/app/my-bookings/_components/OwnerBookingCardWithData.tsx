"use client";

import { BookingCard, BookingCardSkeleton, BookingData } from "~~/components/marketplace";
import { useScaffoldReadContract } from "~~/hooks/scaffold-hbar";
import { parseBooking } from "~~/utils/hedera";

interface OwnerBookingCardWithDataProps {
  bookingId: bigint;
  onClaimPayout: (bookingId: bigint) => void;
  isClaimingPayout: boolean;
}

export const OwnerBookingCardWithData = ({
  bookingId,
  onClaimPayout,
  isClaimingPayout,
}: OwnerBookingCardWithDataProps) => {
  const { data: bookingData, isLoading } = useScaffoldReadContract({
    contractName: "SubscriptionMarketplace",
    functionName: "bookingsById",
    args: [bookingId],
    query: { enabled: !!bookingId },
  });

  const booking = parseBooking(bookingData, bookingId);

  if (isLoading || !booking) {
    return <BookingCardSkeleton count={1} />;
  }

  const bookingDataFinal: BookingData = booking;

  return (
    <BookingCard
      booking={bookingDataFinal}
      isOwner={true}
      onClaimPayout={onClaimPayout}
      isClaimingPayout={isClaimingPayout}
    />
  );
};
