package com.example

import kotlin.math.max
import com.example.util.Helper as Assistant

const val VERSION = "1.0"
private var counter = 0
val square = { value: Int -> value * value }

typealias Handler = (String) -> Unit

fun main() {
    val local = 1
    fun nested() {}
}

private fun helper() {}

fun String.shout(): String = uppercase()

val String.initial: Char
    get() = first()

data class Point(val x: Int, var y: Int, scale: Int) {
    val sum: Int = x + y
    val onMove = { dx: Int -> dx }
    val label: String
        get() = "($x, $y)"

    fun distance(): Double = 0.0

    companion object {
        const val ORIGIN = 0

        fun origin() = Point(0, 0, 1)
    }

    class Builder
}

interface Shape {
    val sides: Int

    fun area(): Double
}

fun interface Action {
    fun run()
}

enum class Color(val hex: String) {
    RED("#f00"),
    GREEN("#0f0");

    fun describe() = hex
}

object Registry {
    val items = mutableListOf<String>()

    fun register(item: String) {}
}
