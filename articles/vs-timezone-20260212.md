---
title: "プロダクト内のTimezoneをどげんかする_合意, 移行, CI"
emoji: "🕙"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: ["java", "spring", "archunit", "timezone", "リファクタリング"]
published: false
---

## これはなに

Nstock株式会社でソフトウェアエンジニアをしているnonoです。最近の趣味はコーディングエージェントが判断に悩まないよう実装のブレやポリシーの揺らぎを改称していくことです。

今回は私が開発に携わっているプロダクト「株式報酬SaaS」の中での日時の取り扱いが揺らいでいたのでどげんかした話をします。

## 題材（株式報酬SaaS）のテクノロジースタック

* Java 25
* Spring Boot 4.0.1
* Spring Data JDBC 4.0.1
* PostgreSQL 15

## きっかけ

ある日、QAエンジニアのAさんとの雑談の中でこんな話が出ました。

Aさん「過去時点のデータのセットアップが結構大変で、今はDBを直接更新して用意してるんですよね」
筆者「（過去時点 = システム内で現在日時を取得して記録しているようなとこなら、システム内日時を固定するような仕組みを入れたらいいか）それならやればできそうだしやっときますよー」
Aさん「オッ」

目論見としては、Clockを保持して現在日時を供給する `ClockProvider` コンポーネントを作り、システム内の現在日時を取得する箇所ではこれを通じて取得するようにすればよさそう、と考えていました。課題は実際の繋ぎ込み作業中に見つかりました。

筆者「`OffsetDateTime.now()` と `OffsetDateTime.now(ZoneId.of("Asia/Tokyo")` が混在しとる？」
筆者「部分的に `ZonedDateTime` 使ってるのは背景あるのか？」
筆者「LocalDateTime.now()を素朴にやっている箇所があるな？」
筆者「これWebAppのTimezoneどうなってる？」

```Java
    public static void main(String[] args) {
        // backend内でのタイムゾーンは、DBに保存されるタイムゾーンと同じUTCにしたい。
        // 環境変数TZや、コマンドライン引数user.timezone等よりも設定が優先されるよう、この箇所でUTCタイムゾーンに設定する。
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));

        // 省略
    }
```

筆者「なるほどね」

時刻を固定化する対応は既存を動かさないように繋ぎこみましたが、更なる課題が見つかってしまったのでなんとかしましょう。

## 課題の詳細

我々のプロダクト内において、現在日付/日時の取得に以下のようなパターンが存在していました。

* `LocalDate.now()`
* `LocalDate.now(ZoneId.of("Asia/Tokyo"))`
* `ZonedDateTime.now()`
* `OffsetDateTime.now()`
* `OffsetDateTime.now(ZoneId.of("Asia/Tokyo"))`
* `LocalDateTime.now()`
* `LocalDateTime.now(ZoneId.of("Asia/Tokyo"))`

LocalDate、LocalDateTimeはZone、Offsetを持たない日付/日時情報です。ZonedDateTimeはTimezoneを持ち、OffsetDateTimeはUTCに対するオフセット（時差）を持ちます。

JST（日本標準時）のOffsetは+9時間なので、例えば以下のように誤った変換/比較を行ってしまうと、9hのズレが生じ期待しない挙動を取ってしまいます。
```Java
    @Test
    void 失敗例_toInstantで比較すると意図しない結果になる() {
        LocalDateTime localNow = LocalDateTime.now();
        OffsetDateTime jstNow = OffsetDateTime.now(ZoneId.of("Asia/Tokyo"));

        System.out.println("\n=== LocalDateTimeをJSTとして解釈してInstant変換 ===");
        System.out.println("LocalDateTime.now():                      " + localNow);
        System.out.println("OffsetDateTime.now(Asia/Tokyo):           " + jstNow);

        // LocalDateTimeをJSTとして解釈してInstantに変換（誤った解釈）
        var localAsJstInstant = localNow.atZone(ZoneId.of("Asia/Tokyo")).toInstant();
        var jstInstant = jstNow.toInstant();

        System.out.println("LocalDateTime -> JST解釈 -> Instant:      " + localAsJstInstant);
        System.out.println("OffsetDateTime(JST) -> Instant:           " + jstInstant);

        // この比較は論理的に誤り！
        // LocalDateTime.now()はUTCの時刻を返すのに、それをJSTとして解釈してしまっている
        // 実際の時刻より9時間進んだ時刻として扱われる
        boolean equals = localAsJstInstant.equals(jstInstant);
        System.out.println("equals()の結果: " + equals + " (false - 9時間のずれが発生)");

        long hoursDiff = java.time.Duration.between(jstInstant, localAsJstInstant).toHours();
        System.out.println("時差: " + Math.abs(hoursDiff) + "時間のずれ");
    }
```

初動としてこのような可能性がないか調査しましたが、取得した現在日時の大半は業務ロジックに関わりのないメタデータであり、実害はありませんでした。一方で将来的には、以下のような懸念点がありました。

1. 社内でのプロダクト連携を進めており、仮に日時情報を連携するとなった場合、その日時のTimezoneを保証しておく必要がある。
2. 現在起きていないとしても、誤った日時比較を行ってしまう潜在的なリスクがある。

特に2点目はコードベースの広がりに応じて増えていくリスクとなるため、早期に対応することが望ましいと判断しました。

## じゃあやっていこう - 移行

移行は大きく、以下のような段階を踏んで進めました。

1. 合意形成
2. 方針に反するコードが増えないよう初期的なガードを実装
3. 方針に合わせて取得方法を統一
4. アプリケーション内での時刻生成以外のケースに対応

### 合意形成

まずはどのような状態を目指すのかを決める必要があります。論点は2つです。

1. UTCを基準として取り回すか、JSTを基準として取り回すか
2. 利用するClassに制限を設けるか否か

今回の場合、初期に定義した日時の取り扱いについての定義があり、そこでは `LocalDate.now(ZoneId.of("Asia/Tokyo"))` のように取得することが定められていました。
OSのTimezoneに依存せず常にアプリケーションで制御する方法は、可搬性を考えると妥当そうです。また現状のプロダクトは日本の会社法/税法に基づいた業務ロジックを多くもつドメスティックなサービスであり、開発者も全員日本居住のため、JSTを基本とする方向は良さそうです。

利用Classには少し議論がありましたが、最終的には以下の方針に決めました。

* 日付はLocalDateを用いる。またJSTとする。
* 日時はOffsetDateTimeを用いる。
* ZonedDateTime, LocalDateTimeは利用禁止

日付にLocalDateを用いることは大きな議論はなく決まりました。またLocalDateTimeはTimezone, Offsetを含まないため混在時のリスクが大きいことから禁止としました（関連する別の課題もありますが後述します）。

ZonedDateTimeを禁止するモチベーションは積極的ではありませんが、OffsetDateTimeで十分取り回しうることと、当面（夏時間対応のような要件が出てくるまでは）OffsetDateTimeで対応しきれることから、実装方法の分散を避けるため一旦禁止としました。

:::message
一方で我々の開発組織の規模では、規約の変更難易度はそこまで高くありません。
ZonedDateTimeは実装ブレのリスクから禁止に倒しましたが、何らかの要件により解禁する可能性も十分あります。あくまで記述時点の、我々の状態における判断であることはご留意ください。
:::

また一点わかったこととして、合意されたルールは存在するものの、見落としや実装のブレによりルールが守りきれておらず、それによりリスクを埋め込んでしまう状態になっていました。そのため今回の統一を行ったとしても同様の原因でリスクを埋め込んでしまうことがないよう、ガードレールを設けるところまでやり切る必要性を感じました。

### 初期的なガード

初期的なガードとして、3つのアプローチを行いました。

1. 合意した事項をdocにまとめてGit Repositoryに追加
2. コーディングエージェント向けのReferenceに上記のdocを追加
3. ArchUnitを用いて、ClockProvider以外からの現在日時取得を禁止

1は自明、2も今風ですが自明なので、3について掘り下げましょう。

今回のきっかけになった出来事から、プロダクトに `ClockProvider` という時刻を供給するコンポーネントを追加しました。以降の取得方法の統一を進めていくうえでは、このコンポーネントがもつ機能/interfaceを徐々に減らしていくという登り方ができると良さそうです。

しかし、ClockProviderを経由しない方法で取得する実装が新規に追加されてしまうと、最終的に達成したい状態が達成できません。そのため、ArchUnitを利用しました。ArchUnitはアーキテクチャルールをテストコードとして記述・検証できるライブラリです。JUnit上で動作するので、CIでテストを実行するのと同じようにアーキテクチャの検証を継続的に行えます。

https://www.archunit.org/

以下のようなRuleをArchUnitで追加し、現在時刻は必ずClockProviderを経由して取得させるようにしました。

```Java
@AnalyzeClasses(packages = "jp.nstock.backend", importOptions = ImportOption.DoNotIncludeTests.class)
public class ClockProviderArchitectureTest {

    @ArchTest
    static final ArchRule should_not_call_LocalDate_now_directly = noClasses()
            .that()
            .resideOutsideOfPackage("jp.nstock.backend.common..")
            .should()
            .callMethod(LocalDate.class, "now")
            .orShould()
            .callMethod(LocalDate.class, "now", java.time.Clock.class)
            .orShould()
            .callMethod(LocalDate.class, "now", java.time.ZoneId.class)
            .because("LocalDate.now() の直接呼び出しは禁止です。ClockProvider.today() を使用してください。");

    // 以降割愛
}
```

これにより現在日時はすべてClockProviderを経由して取得することが保証できます。

### 取得方法を統一

初期的なClockProviderは既存との実装を互換を保つようにしており、擬似的には以下のようなコードにしていました。

```Java
public final class ClockProvider {

    private static final ZoneId DEFAULT_ZONE = ZoneId.systemDefault();

    private static Clock clock = Clock.system(DEFAULT_ZONE);

    private ClockProvider() {
    }

    /**
     * 現在のLocalDateTimeを取得
     */
    public static LocalDateTime now() {
        return LocalDateTime.now(clock);
    }

    /**
     * 現在のLocalDateTimeを取得（指定タイムゾーン）
     */
    public static LocalDateTime now(ZoneId zoneId) {
        return LocalDateTime.now(clock.withZone(zoneId));
    }

    /**
     * 現在のLocalDateを取得
     */
    public static LocalDate today() {
        return LocalDate.now(clock);
    }

    /**
     * 現在のLocalDateを取得（指定タイムゾーン）
     */
    public static LocalDate today(ZoneId zoneId) {
        return LocalDate.now(clock.withZone(zoneId));
    }

    /**
     * 現在のOffsetDateTimeを取得（システムデフォルトタイムゾーン）
     */
    public static OffsetDateTime nowOffset() {
        return OffsetDateTime.now(clock);
    }

    /**
     * 現在のOffsetDateTimeを取得（指定タイムゾーン）
     */
    public static OffsetDateTime nowOffset(ZoneId zoneId) {
        return OffsetDateTime.now(clock.withZone(zoneId));
    }

    /**
     * 現在のOffsetDateTimeを取得（UTC）
     */
    public static OffsetDateTime nowUtc() {
        return OffsetDateTime.now(clock.withZone(ZoneOffset.UTC));
    }

    /**
     * 現在のZonedDateTimeを取得（指定タイムゾーン）
     */
    public static ZonedDateTime nowZoned(ZoneId zoneId) {
        return ZonedDateTime.now(clock.withZone(zoneId));
    }
}
```

前の手順で現在日時はClockProviderから取得するよう統一できました。後はこのClockProviderの取得メソッドが `LocalDate today()` `OffsetDateTime nowOffset()` のみとなり、内部でZoneIdを固定する形になっていれば統一が済んだと言えそうです。

具体的なステップは概ね以下の通りです。

1. 利用の少ないメソッドから順に精査しながら、日付の取得は `LocalDate today(ZoneId)`、現在日時の取得を `OffsetDateTime nowOffset(ZoneId)` を利用するように差し替えていく。また精査の結果を踏まえながらZoneIdとしては `Asia/Tokyo` を渡すようにしていく。
2. 差し替えによりZonedDateTime、LocalDateTimeの利用がなくなった段階で利用を禁止するArchUnit Testを追加
3. 最終的に上述の2メソッドのみが残る状態になったら、引数を除却し、ClockProvider内部で `Asia/Tokyo` を指定するようにする。

この段階での工夫では2で、クリーンな状態が作れた段階で都度ArchUnit Testを追加していくことで巻き戻らないように進めました。

### 時刻生成以外のケースに対応

アプリケーション内での時刻の生成についてはこれで統一できました。これでシステム内で取り扱うOffsetDateTimeはすべて `Asia/Tokyo` のOffsetのものになった…かというと、もう一段あります。

我々はPostgreSQLを利用しており、日時の保存には `timestamp with time zone` を利用しています。この場合、DBに保存される値は常にUTCに補正して格納されます。その上で読み出し時はDB Sessionに設定されたtimezoneを元に復元されます。

https://www.postgresql.jp/document/15/html/datatype-datetime.html
> timestamp with time zoneについて内部に格納されている値は常にUTCです
> timestamp with time zoneの値が出力されると、この値はUTCから現行のtimezoneに変換され、その時間帯のローカル時間として表示されます。
> TimeZoneはpostgresql.confファイルや第20章で説明する他の標準的な方法で設定することができます。

これまで我々はsessionに対して有効なtimezoneを設定していなかったため、OffsetDateTimeは常にUTCで読み出されています。これを例えば `toLocalDate` して日付を得ようとしたり、あるいは文字列parseして外部に渡そうとすると、UTC日付/日時が外部に露出してしまいます。

これを回避するには幾つか選択肢がありますが、タイムゾーンに関する制御をアプリケーションで完結すること、影響範囲が限定的な見通しの良さ等を優先して、以下のようなConverterを追加することで常にJSTとして読み出すようにしました。

```Java
@Configuration
class JdbcConfig extends AbstractJdbcConfiguration {

    /**
     * Spring Data JDBCで利用するカスタムコンバータの一覧を返す。
     * <p>
     * Enum型、JsonPayload型、PGobject型の変換をサポート。
     *
     * @return カスタムコンバータのリスト
     */
    @Override
    protected List<?> userConverters() {
        return List.of(
                new TimestampToOffsetDateTimeConverter());
    }

    /**
     * PostgreSQLのTIMESTAMP WITH TIME ZONE型（java.sql.Timestampとして読み出される）を
     * JSTのOffsetDateTimeに変換するコンバータ。
     * <p>
     * PostgreSQLは内部的にはUTCで保存しているため、java.sql.Timestampとして読み出される際は
     * UTCのタイムスタンプとして扱われる。これをJST (+09:00) のOffsetDateTimeに変換する。
     */
    @ReadingConverter
    public static class TimestampToOffsetDateTimeConverter implements Converter<java.sql.Timestamp, OffsetDateTime> {
        private static final ZoneOffset JST = ZoneOffset.ofHours(9);

        @Override
        public OffsetDateTime convert(java.sql.Timestamp source) {
            if (source == null) {
                return null;
            }
            // TimestampをUTCのOffsetDateTimeに変換してから、JSTに変換
            return source.toInstant()
                    .atOffset(ZoneOffset.UTC)
                    .withOffsetSameInstant(JST);
        }
    }
}
```

:::message
Converter以外の選択肢としては、jvm引数で設定してしまう、JDBC URLやHikariCPをconfigurationするなどが挙げられます。今回は、以下のような理由からConverterを採用しましたが、特に開発初期であれば他の選択肢は十分有効に働くと思います。

* JVM上で動作するアプリケーションにできるだけTimezoneの制御を集約したい。
* Timezone補正済みのOffsetDateTimeをValueObjectとして定義してしまう場合などに、変更を最小化できる。
* あくまでこの作業は草の根的な改善のため、影響範囲をできるだけ最小化したい。
:::

## むすび

株式報酬SaaSではTimezoneの取り扱いの揺らぎを検知して、取り扱いを整理しました。

取得箇所を統一し、ArchUnitを導入することで望ましくない使われ方を段階的かつ確実に減らし、データソースとの境界面も含めて統一しました。潜在的ですが、顕在化する時はたいていリカバリーも修正も困難になっていることの多い部分なので、その前にガードレールを設定できたのは幸運だったと思います。

個人的な意見ですが、コーディングエージェントを活用する上でも、既存のコードベースの実装方針がブレておらず、統一的であり、仮に外れてもCIでフィードバックが出来ることは非常に有用です。その意味でdoc/ArchUnit Ruleの整備は引き続き進めていこうと思います。