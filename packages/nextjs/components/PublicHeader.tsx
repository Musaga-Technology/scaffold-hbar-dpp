"use client";

import React, { useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bars3Icon, BuildingStorefrontIcon, QrCodeIcon, WalletIcon } from "@heroicons/react/24/outline";
import { useOutsideClick } from "~~/hooks/scaffold-hbar/useOutsideClick";

/**
 * Header for the public pages.
 *
 * Carries no wallet connector, and that is the whole point: the connector pulls
 * in RainbowKit, wagmi and WalletConnect — over a megabyte of JavaScript that a
 * stranger scanning a QR code on a product would download and never use.
 *
 * Links into the wallet section still work; those pages mount the connector
 * themselves.
 */
const links = [
  { label: "Home", href: "/" },
  { label: "Verify", href: "/verify/1", icon: <QrCodeIcon className="h-4 w-4" /> },
  { label: "Issuer", href: "/issuer", icon: <BuildingStorefrontIcon className="h-4 w-4" /> },
  { label: "My Passports", href: "/my-passports", icon: <WalletIcon className="h-4 w-4" /> },
];

const NavLinks = () => {
  const pathname = usePathname();
  return (
    <>
      {links.map(({ label, href, icon }) => (
        <li key={href}>
          <Link
            href={href}
            className={`${
              pathname === href ? "bg-primary/10 text-primary font-semibold" : "hover:bg-primary/5"
            } grid grid-flow-col gap-2 rounded-full px-3 py-1.5 text-sm transition-colors`}
          >
            {icon}
            <span>{label}</span>
          </Link>
        </li>
      ))}
    </>
  );
};

export const PublicHeader = () => {
  const burgerMenuRef = useRef<HTMLDetailsElement>(null);
  useOutsideClick(burgerMenuRef, () => burgerMenuRef?.current?.removeAttribute("open"));

  return (
    <div className="navbar sticky top-0 z-20 min-h-0 shrink-0 justify-between border-b border-base-300 bg-base-100 px-0 shadow-sm sm:px-2 lg:static">
      <div className="navbar-start w-auto lg:w-1/2">
        <details className="dropdown" ref={burgerMenuRef}>
          <summary className="btn btn-ghost ml-1 hover:bg-transparent lg:hidden">
            <Bars3Icon className="h-1/2" />
          </summary>
          <ul
            className="menu menu-compact dropdown-content rounded-box mt-3 w-52 bg-base-100 p-2 shadow-sm"
            onClick={() => burgerMenuRef?.current?.removeAttribute("open")}
          >
            <NavLinks />
          </ul>
        </details>
        <Link href="/" className="ml-4 mr-6 hidden shrink-0 items-center gap-3 lg:flex">
          <div className="relative flex h-9 w-9">
            <Image alt="Hedera icon" className="cursor-pointer dark:hidden" fill src="/Hedera-Icon-Dark.svg" />
            <Image alt="Hedera icon" className="hidden cursor-pointer dark:block" fill src="/Hedera-Icon-White.svg" />
          </div>
          <div className="flex flex-col">
            <span className="text-base font-bold leading-tight">Product Passport</span>
            <span className="text-[10px] font-medium uppercase tracking-wider text-base-content/50">
              Built on Hedera
            </span>
          </div>
        </Link>
        <ul className="menu menu-horizontal hidden gap-2 px-1 lg:flex lg:flex-nowrap">
          <NavLinks />
        </ul>
      </div>
    </div>
  );
};
