# M031 Kod Üretici

Bu sürümde MCU saat profilleri, kullanıcının paylaştığı NuTool-ClockConfigure içeriklerinden alınarak genişletildi.

Öne çıkanlar:
- M031 ve M031BT chip listesi eklendi
- Paket bilgisi ve maksimum HCLK bilgisi gösteriliyor
- Kod çıktısına seçilen chip bilgisi ekleniyor
- ADC, UART0 ve TIMER0 akışı korunuyor

Not:
- Pin listesi şu an ortak SYS tabanından geliyor
- Paket bazlı fiziksel pin filtreleme henüz aktif değil
- Bunun için bir sonraki adımda NuTool-PinConfigure verisi entegre edilmeli
