import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '../../components/marketing';
import { productMeta } from '../../content/marketing/product';
import { ProductBody } from '../../features/marketing/product/ProductBody';

export const Route = createFileRoute('/(marketing)/product')({
  head: () => pageHead(productMeta),
  component: ProductBody,
});
