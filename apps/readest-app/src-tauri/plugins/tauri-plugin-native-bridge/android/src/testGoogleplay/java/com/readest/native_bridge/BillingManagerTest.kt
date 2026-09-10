package com.readest.native_bridge

import android.app.Activity
import com.android.billingclient.api.*
import org.junit.Assert.*
import org.junit.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.*

class BillingManagerTest {
    private fun query(code: Int, details: List<ProductDetails>, type: String): List<ProductData> {
        val client = mock(BillingClient::class.java)
        val manager = BillingManager(mock(Activity::class.java))
        BillingManager::class.java.getDeclaredField("billingClient").apply {
            isAccessible = true
            set(manager, client)
        }
        val result = mock(QueryProductDetailsResult::class.java)
        `when`(result.productDetailsList).thenReturn(details)
        doAnswer { invocation ->
            invocation.getArgument<ProductDetailsResponseListener>(1).onProductDetailsResponse(
                BillingResult.newBuilder().setResponseCode(code).build(), result
            )
            null
        }.`when`(client).queryProductDetailsAsync(any(QueryProductDetailsParams::class.java), any(ProductDetailsResponseListener::class.java))
        var products: List<ProductData>? = null
        var calls = 0
        val callback: (List<ProductData>) -> Unit = { products = it; calls++ }
        BillingManager::class.java.getDeclaredMethod(
            "fetchProductsOfType", List::class.java, String::class.java, kotlin.jvm.functions.Function1::class.java
        ).apply { isAccessible = true }.invoke(manager, listOf("bookarc.product"), type, callback)
        assertEquals(1, calls)
        return requireNotNull(products)
    }

    private fun product(): ProductDetails = mock(ProductDetails::class.java).also {
        `when`(it.productId).thenReturn("bookarc.product")
        `when`(it.title).thenReturn("BookArc")
        `when`(it.description).thenReturn("Reading")
    }

    @Test fun oneTimeProductsKeepTheirPriceAndCurrencyFromBilling8Results() {
        val product = product()
        val offer = mock(ProductDetails.OneTimePurchaseOfferDetails::class.java)
        `when`(offer.formattedPrice).thenReturn("€4.99")
        `when`(offer.priceCurrencyCode).thenReturn("EUR")
        `when`(offer.priceAmountMicros).thenReturn(4990000L)
        `when`(product.oneTimePurchaseOfferDetails).thenReturn(offer)
        val actual = query(BillingClient.BillingResponseCode.OK, listOf(product), BillingClient.ProductType.INAPP).single()
        assertEquals("bookarc.product", actual.id)
        assertEquals("€4.99", actual.price)
        assertEquals("EUR", actual.priceCurrencyCode)
        assertEquals(4990000L, actual.priceAmountMicros)
        assertEquals("consumable", actual.productType)
    }

    @Test fun subscriptionsKeepTheirPricingPhaseFromBilling8Results() {
        val product = product()
        val offer = mock(ProductDetails.SubscriptionOfferDetails::class.java)
        val phases = mock(ProductDetails.PricingPhases::class.java)
        val phase = mock(ProductDetails.PricingPhase::class.java)
        `when`(phase.formattedPrice).thenReturn("$9.99")
        `when`(phase.priceCurrencyCode).thenReturn("USD")
        `when`(phase.priceAmountMicros).thenReturn(9990000L)
        `when`(phases.pricingPhaseList).thenReturn(listOf(phase))
        `when`(offer.pricingPhases).thenReturn(phases)
        `when`(product.subscriptionOfferDetails).thenReturn(listOf(offer))
        val actual = query(BillingClient.BillingResponseCode.OK, listOf(product), BillingClient.ProductType.SUBS).single()
        assertEquals("$9.99", actual.price)
        assertEquals("USD", actual.priceCurrencyCode)
        assertEquals(9990000L, actual.priceAmountMicros)
        assertEquals("subscription", actual.productType)
    }

    @Test fun failedQueriesDoNotExposeProducts() {
        assertTrue(query(BillingClient.BillingResponseCode.SERVICE_UNAVAILABLE, listOf(product()), BillingClient.ProductType.INAPP).isEmpty())
    }

    @Test fun missingOffersAndEmptyResultsDoNotBecomePurchasableProducts() {
        assertTrue(query(BillingClient.BillingResponseCode.OK, listOf(product()), BillingClient.ProductType.INAPP).isEmpty())
        assertTrue(query(BillingClient.BillingResponseCode.OK, emptyList(), BillingClient.ProductType.SUBS).isEmpty())
    }
}
